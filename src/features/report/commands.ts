import {
  ensureSetting,
  historyDir,
  isoNow,
  readSetting,
  reportDir,
  settingPath,
  writeSetting,
} from './setting'
import { DEFAULT_SETTING, type GatherRepoOut, type ReportSetting, type RepoEntry } from './types'
import { collectCommits, computeSessionHours, detectProject, isGitRepo, tryExec } from './git'
import { copyToClipboard } from './clipboard'
import * as fs from 'fs'
import * as path from 'path'

function fail(msg: string, code = 1): never {
  console.error(msg)
  process.exit(code)
}

export function cmdInit(opts: {
  role?: string
  autoCopy?: string
  dayStart?: string
  dayEnd?: string
}): void {
  let setting = ensureSetting()

  if (opts.role) {
    setting.role = opts.role
    writeSetting(setting)
    setting = readSetting()!
  }
  if (opts.autoCopy !== undefined) {
    setting.auto_copy = opts.autoCopy === 'true' || opts.autoCopy === '1'
    writeSetting(setting)
    setting = readSetting()!
  }
  if (opts.dayStart) {
    if (!/^\d{1,2}:\d{2}$/.test(opts.dayStart)) {
      fail('❌ --day-start 格式必须为 HH:MM，如 09:30')
    }
    setting.day_start_max = opts.dayStart
    writeSetting(setting)
    setting = readSetting()!
  }
  if (opts.dayEnd) {
    if (!/^\d{1,2}:\d{2}$/.test(opts.dayEnd)) {
      fail('❌ --day-end 格式必须为 HH:MM，如 20:30')
    }
    setting.day_end_min = opts.dayEnd
    writeSetting(setting)
    setting = readSetting()!
  }

  setting = ensureSetting()
  const roleDef = setting.role_definitions?.[setting.role]
  console.log(
    JSON.stringify(
      {
        memory_dir: reportDir(),
        setting_path: settingPath(),
        role: setting.role,
        auto_copy: setting.auto_copy,
        node_available: true,
        git_user_email: setting.git_user_email,
        day_start_max: setting.day_start_max || DEFAULT_SETTING.day_start_max,
        day_end_min: setting.day_end_min || DEFAULT_SETTING.day_end_min,
        repositories: setting.repositories,
        categories: roleDef?.soft_work_categories ?? [],
        use_git: roleDef?.use_git ?? false,
      },
      null,
      2,
    ),
  )
}

export function cmdGather(opts: {
  date?: string
  author?: string
  dayStart?: string
  dayEnd?: string
  userRepos?: string[]
  reposJson?: string
}): void {
  const setting = readSetting()
  let repos: Array<Partial<RepoEntry> & { path: string; _source?: string }> = []

  if (opts.reposJson) {
    try {
      repos = JSON.parse(opts.reposJson) as typeof repos
    } catch (e) {
      fail(`❌ --repos JSON 解析失败：${e instanceof Error ? e.message : String(e)}`)
    }
  } else if (setting?.repositories?.length) {
    repos = [...setting.repositories].sort((a, b) =>
      (b.last_used_at || '').localeCompare(a.last_used_at || ''),
    )
  }

  const now = isoNow()
  const cwd = process.cwd()
  const seen = new Set(repos.map((r) => r.path))
  const toAdd: typeof repos = []

  if (isGitRepo(cwd) && !seen.has(cwd)) {
    toAdd.push({
      path: cwd,
      alias: path.basename(cwd),
      display_name: '',
      git_remote: tryExec(`git -C "${cwd}" config --get remote.origin.url`),
      _source: 'cwd',
    })
    seen.add(cwd)
  }

  for (const p of opts.userRepos ?? []) {
    const abs = path.resolve(p)
    if (!fs.existsSync(abs)) {
      console.error(`⚠️ 仓库路径不存在, 跳过: ${abs}`)
      continue
    }
    if (!fs.statSync(abs).isDirectory()) {
      console.error(`⚠️ 不是目录, 跳过: ${abs}`)
      continue
    }
    if (!isGitRepo(abs)) {
      console.error(`⚠️ 不是 git repo, 跳过: ${abs}`)
      continue
    }
    if (!seen.has(abs)) {
      toAdd.push({
        path: abs,
        alias: path.basename(abs),
        display_name: '',
        git_remote: tryExec(`git -C "${abs}" config --get remote.origin.url`),
        _source: 'user',
      })
      seen.add(abs)
    }
  }

  repos = [...repos, ...toAdd]
  const date = opts.date || new Date().toISOString().slice(0, 10)
  const authorOverride = opts.author || ''
  const gitUserEmail = setting?.git_user_email || ''

  if (repos.length === 0) {
    console.error('⚠️ 没有可采集的仓库 (cwd 不是 git, 用户指定路径全部无效)')
    console.error('   请确认 cwd 是 git 仓库, 或用 --user-repo <path> 指定有效仓库')
    console.log(
      JSON.stringify({ date, repos: [], totals: { hours: 0, count: 0 }, warning: 'no_repos' }, null, 2),
    )
    return
  }

  const reposOut: GatherRepoOut[] = []
  let totalHours = 0
  let totalCount = 0
  let dirty = false
  let nextSetting: ReportSetting | null = setting ? { ...setting, repositories: [...setting.repositories] } : null

  for (const repo of repos) {
    const repoPath = repo.path
    const alias = repo.alias || path.basename(repoPath)

    if (nextSetting) {
      const idx = nextSetting.repositories.findIndex((r) => r.path === repoPath)
      if (idx !== -1) {
        if (nextSetting.repositories[idx]!.last_used_at !== now) {
          nextSetting.repositories[idx]!.last_used_at = now
          dirty = true
        }
      } else {
        const gitRemote = isGitRepo(repoPath)
          ? tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
          : ''
        nextSetting.repositories.push({
          path: repoPath,
          alias,
          display_name: repo.display_name || '',
          git_remote: gitRemote,
          added_at: now,
          last_used_at: now,
        })
        dirty = true
        console.error(`✅ 已存档用户指定仓库：${alias} → ${repoPath}`)
      }
    }

    const project = repo.display_name || alias || detectProject(repoPath) || '通用'
    const author = authorOverride || gitUserEmail
    const commits = collectCommits(repoPath, date, author)
    if (commits.length === 0) continue

    const dayStartMax = opts.dayStart || setting?.day_start_max || DEFAULT_SETTING.day_start_max
    const dayEndMin = opts.dayEnd || setting?.day_end_min || DEFAULT_SETTING.day_end_min
    const repoHours = computeSessionHours(commits, date, dayStartMax, dayEndMin)
    const items = commits.map((c) => ({ commit: c.subject, time: c.time }))

    totalHours += repoHours
    totalCount += items.length
    reposOut.push({
      path: repoPath,
      alias,
      display_name: repo.display_name || '',
      project,
      items,
      total_hours: repoHours,
      total_count: items.length,
    })
  }

  if (dirty && nextSetting) writeSetting(nextSetting)

  if (reposOut.length === 0) {
    console.error(`⚠️ ${date} 全部仓库 (${repos.length} 个) 都没有 commit`)
    console.error('   可能原因: 今天没提交 / --author 过滤掉了所有 commit / git_user_email 配置错误')
  }

  console.log(
    JSON.stringify(
      {
        date,
        repos: reposOut,
        totals: { hours: totalHours, count: totalCount },
      },
      null,
      2,
    ),
  )
}

function validateDailyLines(daily: string): string[] {
  const lineRe = /^\d+\.\s+【[^】]+】.+[。.]-\s*\d+(\.5)?小时\s*$/
  const lines = daily
    .trim()
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) fail('❌ --daily 为空')
  for (const line of lines) {
    if (!lineRe.test(line)) {
      console.error(`❌ 分点格式非法（须含【项目名】与 - X小时）：${line}`)
      console.error('   例：1. 【车辆调度】修复列表接口字段适配。- 2小时')
      process.exit(1)
    }
  }
  return lines
}

function saveHistory(date: string, daily: string, sheetLine: string): string {
  fs.mkdirSync(historyDir(), { recursive: true })
  const filePath = path.join(historyDir(), `${date}.md`)
  const body = [
    `# 日报 ${date}`,
    '',
    sheetLine,
    '',
    daily.trimEnd(),
    '',
    `<!-- emitted_at: ${isoNow()} -->`,
    '',
  ].join('\n')
  fs.writeFileSync(filePath, body, 'utf8')
  return filePath
}

export function cmdEmit(opts: {
  daily?: string
  sheetTime?: string
  date?: string
  noClipboard?: boolean
}): void {
  const daily = opts.daily || ''
  const sheetTime = (opts.sheetTime || '').trim()
  if (!daily.trim() || !sheetTime) {
    fail('usage: tkt report emit --daily "<分点>" --sheet-time "<单行概括>" [--date YYYY-MM-DD] [--no-clipboard]')
  }

  validateDailyLines(daily)

  const sheetBody = sheetTime.replace(/^sheetTime:\s*/i, '').trim()
  if (!sheetBody) fail('❌ --sheet-time 不能为空')
  if (/[\n\r]/.test(sheetBody) || /【/.test(sheetBody) || /小时/.test(sheetBody)) {
    fail('❌ sheetTime 须单行、无【项目名】、无小时数')
  }
  if ([...sheetBody].length > 80) fail('❌ sheetTime 超过 80 字，请截断后再 emit')

  const date = opts.date || new Date().toISOString().slice(0, 10)
  const sheetLine = `sheetTime: ${sheetBody}`
  console.log(sheetLine)
  console.log('')
  console.log(daily.trimEnd())

  try {
    const saved = saveHistory(date, daily, sheetLine)
    console.error(`✅ 已归档: ${saved}`)
  } catch (e) {
    console.error(`⚠️ 归档失败（不阻断）: ${e instanceof Error ? e.message : String(e)}`)
  }

  const setting = readSetting()
  const skipClip = opts.noClipboard || setting?.auto_copy !== true
  if (skipClip) return

  try {
    const { ok, detail } = copyToClipboard(daily)
    if (ok) console.error('✅ 已自动复制到剪贴板（仅分点）')
    else {
      console.error(`⚠️ 剪贴板失败：${detail || 'unknown'}`)
      console.error('   日报已打印到 stdout，请手动复制')
    }
  } catch (e) {
    console.error(`⚠️ 剪贴板失败：${e instanceof Error ? e.message : String(e)}`)
    console.error('   日报已打印到 stdout，请手动复制')
  }
}

export function cmdClipboard(): void {
  const input = fs.readFileSync(0, 'utf8')
  const { ok, detail } = copyToClipboard(input)
  if (ok) {
    console.log('✅ 已自动复制到剪贴板')
    return
  }
  console.error(`❌ 剪贴板复制失败：${detail || 'unknown'}`)
  process.exitCode = 1
}

export function cmdSaveRepo(opts: {
  path?: string
  alias?: string
  displayName?: string
  cwd?: boolean
  touch?: boolean
}): void {
  let repoPath = opts.path || ''
  if (opts.cwd) repoPath = process.cwd()
  if (!repoPath) fail('usage: tkt report save-repo --path <path> [--alias <alias>] [--cwd] [--touch]')

  repoPath = path.resolve(repoPath)
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    fail(`❌ 目录不存在：${repoPath}`)
  }

  const setting = readSetting()
  if (!setting) fail('❌ setting.json 不存在，先跑 tkt report init')

  const gitRemote = tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
  const gitUserEmail = tryExec(`git -C "${repoPath}" config --get user.email`)
  const now = isoNow()

  if (gitUserEmail && !setting.git_user_email) setting.git_user_email = gitUserEmail
  setting.repositories = setting.repositories || []

  if (opts.touch) {
    const idx = setting.repositories.findIndex((r) => r.path === repoPath)
    if (idx === -1) {
      console.error(`⚠️ 仓库不在列表中，跳过 touch：${repoPath}`)
      return
    }
    setting.repositories[idx]!.last_used_at = now
    writeSetting(setting)
    console.log(JSON.stringify(setting.repositories[idx], null, 2))
    return
  }

  const pathIdx = setting.repositories.findIndex((r) => r.path === repoPath)
  if (pathIdx !== -1) {
    if (opts.alias) setting.repositories[pathIdx]!.alias = opts.alias
    if (opts.displayName) setting.repositories[pathIdx]!.display_name = opts.displayName
    setting.repositories[pathIdx]!.last_used_at = now
    writeSetting(setting)
    console.log(`✅ 已更新（按 path 命中）：${repoPath}`)
    console.log(JSON.stringify(setting.repositories[pathIdx], null, 2))
    return
  }

  if (gitRemote) {
    const remoteIdx = setting.repositories.findIndex((r) => r.git_remote === gitRemote)
    if (remoteIdx !== -1) {
      setting.repositories[remoteIdx]!.path = repoPath
      setting.repositories[remoteIdx]!.last_used_at = now
      if (opts.alias) setting.repositories[remoteIdx]!.alias = opts.alias
      if (opts.displayName) setting.repositories[remoteIdx]!.display_name = opts.displayName
      writeSetting(setting)
      console.log(`✅ 已更新 path（按 git_remote 命中）：${setting.repositories[remoteIdx]!.alias}`)
      console.log(JSON.stringify(setting.repositories[remoteIdx], null, 2))
      return
    }
  }

  const alias = opts.alias || path.basename(repoPath)
  const newRepo: RepoEntry = {
    path: repoPath,
    alias,
    display_name: opts.displayName || '',
    git_remote: gitRemote,
    added_at: now,
    last_used_at: now,
  }
  setting.repositories.push(newRepo)
  writeSetting(setting)
  console.log(`✅ 已添加仓库：${alias} → ${repoPath}`)
  console.log(JSON.stringify(newRepo, null, 2))
}

export function cmdListRepos(opts: {
  json?: boolean
  current?: boolean
  autoDetectCwd?: boolean
}): void {
  const setting = readSetting()
  if (!setting) fail('❌ setting.json 不存在，先跑 tkt report init')

  let repos = [...(setting.repositories || [])].sort((a, b) =>
    (b.last_used_at || '').localeCompare(a.last_used_at || ''),
  )

  if (opts.autoDetectCwd) {
    const cwd = process.cwd()
    if (isGitRepo(cwd)) {
      const idx = setting.repositories.findIndex((r) => r.path === cwd)
      const now = isoNow()
      if (idx !== -1) {
        setting.repositories[idx]!.last_used_at = now
        repos = repos.map((r) => (r.path === cwd ? { ...r, last_used_at: now } : r))
        console.error(`✅ cwd 已存档，touch last_used_at：${path.basename(cwd)}`)
      } else {
        const alias = path.basename(cwd)
        const gitRemote = tryExec(`git -C "${cwd}" config --get remote.origin.url`)
        const newRepo: RepoEntry = {
          path: cwd,
          alias,
          display_name: '',
          git_remote: gitRemote,
          added_at: now,
          last_used_at: now,
        }
        setting.repositories.push(newRepo)
        repos = [newRepo, ...repos]
        console.error(`✅ 已自动存档当前仓库：${alias} → ${cwd}`)
      }
      writeSetting(setting)
    }
  }

  if (opts.current) {
    const hit = repos.find((r) => r.path === process.cwd())
    console.log(hit ? hit.alias : '')
    return
  }

  if (opts.json) {
    console.log(JSON.stringify(repos, null, 2))
    return
  }

  if (repos.length === 0) {
    console.error('（暂无保存的仓库）')
    return
  }
  for (const r of repos) {
    console.log(`${r.alias}\t${r.path}\t${r.git_remote || '-'}\t${r.last_used_at || '-'}`)
  }
}

export function cmdSetDisplayName(opts: { path?: string; name?: string }): void {
  if (!opts.path || !opts.name) {
    fail('usage: tkt report set-display-name --path <repo-path> --name "<中文名>"')
  }
  const setting = readSetting()
  if (!setting) fail('❌ setting.json 不存在，先跑 tkt report init')

  const repoPath = path.resolve(opts.path)
  const idx = (setting.repositories || []).findIndex((r) => r.path === repoPath)
  if (idx === -1) fail(`❌ 仓库不在列表中：${repoPath}`)

  setting.repositories[idx]!.display_name = opts.name
  writeSetting(setting)
  console.log(`✅ 已存档翻译：${setting.repositories[idx]!.alias} → ${opts.name}`)
  console.log(JSON.stringify(setting.repositories[idx], null, 2))
}
