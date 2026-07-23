/** 本地编排：prefs → 名单勾选 → gather → AI → deliver */
import chalk from 'chalk'
import * as path from 'path'
import { generateDailyPlan } from './ai'
import {
  ensurePrefs,
  fillMissingDisplayNames,
  loadSetting,
  promptAppendOnly,
  promptRoster,
  setShowRoster,
  writeSetting,
} from './config'
import {
  assertPlan,
  buildRecord,
  deliver,
  formatDaily,
  halfHour,
  normalizeSheetTime,
} from './deliver'
import { discoverRepos, gatherToday } from './gather'
import type { ReportOptions } from './types'

function applyDisplayNames(pairs: Array<{ path: string; name: string }>): void {
  if (!pairs.length) return
  const setting = loadSetting()
  let dirty = false
  for (const { path: p, name } of pairs) {
    const abs = path.resolve(p)
    const n = name.trim()
    // 只要中文名；拒绝 KaoQin-Attendance 这类英文
    if (!n || !/[\u4e00-\u9fff]/.test(n)) continue
    const i = setting.repositories.findIndex((r) => r.path === abs)
    if (i < 0) continue
    const cur = setting.repositories[i]!
    if (cur.name_custom || /[\u4e00-\u9fff]/.test(cur.display_name || '')) continue
    cur.display_name = n
    dirty = true
    console.error(`✅ ${cur.alias} → ${n}`)
  }
  if (dirty) writeSetting(setting)
}

export async function runReport(options: ReportOptions = {}): Promise<void> {
  const prefs = await ensurePrefs({ role: options.role })
  const date = options.date || new Date().toISOString().slice(0, 10)

  let append = [...(options.append ?? [])]
  let onlyPaths: string[] | undefined

  if (prefs.useGit) {
    let repos = discoverRepos({ userRepos: options.userRepos })
    repos = await fillMissingDisplayNames(repos, { quiet: Boolean(options.json) })

    const interactive = process.stdin.isTTY && !options.json
    if (interactive) {
      if (options.forceRoster) setShowRoster(true)
      if (options.skipRoster) setShowRoster(false)

      const showRoster = options.forceRoster
        ? true
        : options.skipRoster
          ? false
          : loadSetting().show_roster !== false

      const picked = showRoster
        ? await promptRoster(repos)
        : await promptAppendOnly(repos)
      onlyPaths = picked.repos.filter((r) => r.enabled).map((r) => r.path)
      if (picked.append) append.push(picked.append)
    } else {
      onlyPaths = repos.filter((r) => r.enabled).map((r) => r.path)
    }
  }

  const gather = prefs.useGit
    ? gatherToday({
        date,
        dayStart: options.dayStart,
        dayEnd: options.dayEnd,
        userRepos: options.userRepos,
        onlyPaths,
      })
    : { date, repos: [], sessionHours: 0, commitCount: 0 }

  if (!prefs.useGit) {
    console.error(chalk.dim('非开发角色：跳过 git gather'))
  } else if (gather.commitCount === 0) {
    console.error(chalk.yellow('今日无 commit（或未勾选仓库），将按主动型类目补齐（可附带补充）'))
  } else {
    console.error(
      chalk.dim(
        `采集 ${gather.repos.length} 仓 · ${gather.commitCount} commit · session ${gather.sessionHours}h`,
      ),
    )
  }

  const targetHours = Math.max(options.targetHours ?? 8, gather.sessionHours)

  const plan = await generateDailyPlan({
    role: prefs.role,
    categories: prefs.categories,
    targetHours,
    gather,
    append,
    dayStart: options.dayStart,
    dayEnd: options.dayEnd,
    quiet: Boolean(options.json),
  })

  plan.items = plan.items.map((it) => ({
    ...it,
    hours: halfHour(it.hours),
    project: it.project.trim() || '通用',
    text: it.text.trim(),
  }))
  assertPlan(plan, targetHours)
  applyDisplayNames(plan.displayNames)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          targetHours,
          gather,
          plan,
          record: buildRecord({
            plan,
            date,
            role: prefs.role,
            targetHours,
            sessionHours: gather.sessionHours,
            commitCount: gather.commitCount,
          }),
        },
        null,
        2,
      ),
    )
  }

  if (options.dryRun) {
    console.log(chalk.yellow('[dry-run]'))
    console.log(`sheetTime: ${normalizeSheetTime(plan.sheetTime)}`)
    console.log('')
    console.log(formatDaily(plan))
    return
  }

  deliver({
    plan,
    date,
    role: prefs.role,
    targetHours,
    sessionHours: gather.sessionHours,
    commitCount: gather.commitCount,
    autoCopy: prefs.autoCopy,
    noClipboard: options.noClipboard,
    print: !options.json,
  })
}
