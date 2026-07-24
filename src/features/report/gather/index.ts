/** 发现候选仓库 + 仅采集 enabled */
import * as fs from 'fs'
import * as path from 'path'
import { isoNow, loadSetting, writeSetting } from '../setting'
import type { GatherRepo, GatherResult, ReportSetting, RepoEntry } from '../types'
import { resolveWorkWindow } from '../hours'
import { collectSubjects, detectProject, isGitRepo, daySessionHours, repoSpanHours, tryExec } from './git'

export type GatherOpts = {
  date: string
  dayStart?: string
  dayEnd?: string
  userRepos?: string[]
  /** 仅这些 path；默认用 setting.enabled */
  onlyPaths?: string[]
}

function remoteOf(repoPath: string): string {
  return tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
}

function touchRepo(
  setting: ReportSetting,
  entry: Omit<RepoEntry, 'added_at' | 'last_used_at'> & {
    added_at?: string
    enabled?: boolean
  },
): RepoEntry {
  const now = isoNow()
  const idx = setting.repositories.findIndex((r) => r.path === entry.path)
  if (idx >= 0) {
    const cur = setting.repositories[idx]!
    cur.last_used_at = now
    if (!cur.display_name && entry.display_name) cur.display_name = entry.display_name
    if (entry.git_remote) cur.git_remote = entry.git_remote
    if (typeof entry.enabled === 'boolean') cur.enabled = entry.enabled
    if (typeof cur.enabled !== 'boolean') cur.enabled = true
    return cur
  }
  const created: RepoEntry = {
    path: entry.path,
    alias: entry.alias,
    display_name: entry.display_name || '',
    git_remote: entry.git_remote || '',
    enabled: entry.enabled ?? true,
    added_at: now,
    last_used_at: now,
  }
  setting.repositories.push(created)
  return created
}

/** 合并 setting / cwd / --user-repo，写入 setting，不采 commit */
export function discoverRepos(opts: { userRepos?: string[] } = {}): RepoEntry[] {
  const setting = loadSetting()
  const byPath = new Map<string, RepoEntry>()

  for (const r of setting.repositories) {
    if (typeof r.enabled !== 'boolean') r.enabled = true
    byPath.set(r.path, r)
  }

  const cwd = process.cwd()
  if (isGitRepo(cwd)) {
    const remote = byPath.get(cwd)?.git_remote || remoteOf(cwd)
    if (!byPath.has(cwd)) {
      byPath.set(
        cwd,
        touchRepo(setting, {
          path: cwd,
          alias: path.basename(cwd),
          display_name: '',
          git_remote: remote,
          enabled: !/github\.com/i.test(remote),
        }),
      )
    } else {
      const cur = byPath.get(cwd)!
      touchRepo(setting, {
        path: cwd,
        alias: cur.alias,
        display_name: cur.display_name,
        git_remote: cur.git_remote || remote,
        enabled: cur.enabled,
      })
    }
  }

  for (const raw of opts.userRepos ?? []) {
    const abs = path.resolve(raw)
    if (!fs.existsSync(abs) || !isGitRepo(abs)) continue
    if (byPath.has(abs)) {
      touchRepo(setting, {
        path: abs,
        alias: byPath.get(abs)!.alias,
        display_name: byPath.get(abs)!.display_name,
        git_remote: byPath.get(abs)!.git_remote || remoteOf(abs),
        enabled: true,
      })
      continue
    }
    byPath.set(
      abs,
      touchRepo(setting, {
        path: abs,
        alias: path.basename(abs),
        display_name: '',
        git_remote: remoteOf(abs),
        enabled: true,
      }),
    )
  }

  writeSetting(setting)
  return [...setting.repositories].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    return (b.last_used_at || '').localeCompare(a.last_used_at || '')
  })
}

export function gatherToday(opts: GatherOpts): GatherResult {
  const setting = loadSetting()
  const date = opts.date
  const win = resolveWorkWindow(setting, date, {
    dayStart: opts.dayStart,
    dayEnd: opts.dayEnd,
  })
  const dayStart = win.dayStart
  const dayEnd = win.dayEnd
  const author = setting.git_user_email || tryExec('git config --get user.email')

  if (!setting.git_user_email && author) {
    setting.git_user_email = author
    writeSetting(setting)
  }

  const allow = opts.onlyPaths
    ? new Set(opts.onlyPaths.map((p) => path.resolve(p)))
    : null

  const repos: GatherRepo[] = []
  const allCommits: Array<{ time: number }> = []
  let commitCount = 0

  for (const repo of setting.repositories) {
    const repoPath = repo.path
    if (allow) {
      if (!allow.has(path.resolve(repoPath))) continue
    } else if (!repo.enabled) {
      continue
    }
    if (!fs.existsSync(repoPath) || !isGitRepo(repoPath)) continue

    const alias = repo.alias || path.basename(repoPath)
    const commits = collectSubjects(repoPath, date, author)
    const remote = repo.git_remote || remoteOf(repoPath)
    touchRepo(setting, {
      path: repoPath,
      alias,
      display_name: repo.display_name || '',
      git_remote: remote,
      enabled: repo.enabled,
    })
    if (!commits.length) continue

    allCommits.push(...commits)
    commitCount += commits.length
    repos.push({
      path: repoPath,
      alias,
      display_name: repo.display_name || '',
      project: repo.display_name || alias || detectProject(repoPath),
      commits: commits.map((c) => c.subject),
      // 单仓跨度仅作分配参考，全日目标用工时窗（不按仓累加）
      hours: repoSpanHours(commits),
    })
  }

  writeSetting(setting)
  const session = daySessionHours(allCommits, date, dayStart, dayEnd)
  return { date, repos, sessionHours: session, commitCount }
}

export {
  addAndGatherRepo,
  mergeGatherRepo,
  type AddRepoOpts,
  type AddRepoResult,
} from './add-repo'
