/** 合并 cwd / 存档仓库，采集当日 commit */
import * as fs from 'fs'
import * as path from 'path'
import { isoNow, loadSetting, writeSetting } from '../config'
import type { GatherRepo, GatherResult, ReportSetting, RepoEntry } from '../types'
import { collectSubjects, detectProject, isGitRepo, sessionHours, tryExec } from './git'

export type GatherOpts = {
  date: string
  dayStart?: string
  dayEnd?: string
  userRepos?: string[]
}

function touchRepo(
  setting: ReportSetting,
  entry: Omit<RepoEntry, 'added_at' | 'last_used_at'> & { added_at?: string },
): void {
  const now = isoNow()
  const idx = setting.repositories.findIndex((r) => r.path === entry.path)
  if (idx >= 0) {
    setting.repositories[idx]!.last_used_at = now
    if (!setting.repositories[idx]!.display_name && entry.display_name) {
      setting.repositories[idx]!.display_name = entry.display_name
    }
    return
  }
  setting.repositories.push({
    path: entry.path,
    alias: entry.alias,
    display_name: entry.display_name || '',
    git_remote: entry.git_remote || '',
    added_at: now,
    last_used_at: now,
  })
}

export function gatherToday(opts: GatherOpts): GatherResult {
  const setting = loadSetting()
  const date = opts.date
  const dayStart = opts.dayStart || setting.day_start_max
  const dayEnd = opts.dayEnd || setting.day_end_min
  const author = setting.git_user_email || tryExec('git config --get user.email')

  const byPath = new Map<string, Partial<RepoEntry> & { path: string }>()
  for (const r of [...setting.repositories].sort((a, b) =>
    (b.last_used_at || '').localeCompare(a.last_used_at || ''),
  )) {
    byPath.set(r.path, r)
  }

  const cwd = process.cwd()
  if (isGitRepo(cwd) && !byPath.has(cwd)) {
    byPath.set(cwd, {
      path: cwd,
      alias: path.basename(cwd),
      display_name: '',
      git_remote: tryExec(`git -C "${cwd}" config --get remote.origin.url`),
    })
  }

  for (const raw of opts.userRepos ?? []) {
    const abs = path.resolve(raw)
    if (!fs.existsSync(abs) || !isGitRepo(abs) || byPath.has(abs)) continue
    byPath.set(abs, {
      path: abs,
      alias: path.basename(abs),
      display_name: '',
      git_remote: tryExec(`git -C "${abs}" config --get remote.origin.url`),
    })
  }

  if (!setting.git_user_email && author) {
    setting.git_user_email = author
  }

  const repos: GatherRepo[] = []
  let sessionHoursSum = 0
  let commitCount = 0

  for (const repo of byPath.values()) {
    const repoPath = repo.path
    const alias = repo.alias || path.basename(repoPath)
    const commits = collectSubjects(repoPath, date, author)
    touchRepo(setting, {
      path: repoPath,
      alias,
      display_name: repo.display_name || '',
      git_remote: repo.git_remote || tryExec(`git -C "${repoPath}" config --get remote.origin.url`),
    })
    if (!commits.length) continue

    const hours = sessionHours(commits, date, dayStart, dayEnd)
    const project = repo.display_name || alias || detectProject(repoPath)
    sessionHoursSum += hours
    commitCount += commits.length
    repos.push({
      path: repoPath,
      alias,
      display_name: repo.display_name || '',
      project,
      commits: commits.map((c) => c.subject),
      hours,
    })
  }

  writeSetting(setting)
  return { date, repos, sessionHours: sessionHoursSum, commitCount }
}
