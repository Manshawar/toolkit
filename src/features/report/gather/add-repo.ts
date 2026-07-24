/**
 * 追加本地仓：先校验是 git，否则直接退出；通过则入库并采当日 commit。
 * 供 CLI / AI tool 复用。
 */
import * as fs from 'fs'
import * as path from 'path'
import { defaultDisplayName } from '@/ai'
import { isoNow, loadSetting, writeSetting } from '../setting'
import type { GatherRepo, RepoEntry } from '../types'
import { collectSubjects, detectProject, isGitRepo, repoSpanHours, tryExec } from './git'

export type AddRepoOk = {
  ok: true
  path: string
  alias: string
  display_name: string
  git_remote: string
  enabled: true
  /** 当日有 commit 时非 null */
  gather: GatherRepo | null
  commitCount: number
}

export type AddRepoFail = {
  ok: false
  path: string
  error: string
}

export type AddRepoResult = AddRepoOk | AddRepoFail

export type AddRepoOpts = {
  date: string
  dayStart?: string
  dayEnd?: string
}

function remoteOf(repoPath: string): string {
  return tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
}

/**
 * 用户传入仓库路径 → 必须是 git，否则 `{ ok:false }` 退出；
 * 是 git 则写入名单（enabled=true）并采集当日 commit。
 */
export function addAndGatherRepo(rawPath: string, opts: AddRepoOpts): AddRepoResult {
  const abs = path.resolve(rawPath.trim())
  if (!rawPath.trim()) {
    return { ok: false, path: abs, error: 'empty path' }
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, path: abs, error: 'path not found' }
  }
  // 先看有没有 git：没有就退出，不写库
  if (!isGitRepo(abs)) {
    return { ok: false, path: abs, error: 'not a git repository' }
  }

  const setting = loadSetting()
  const alias = path.basename(abs)
  const remote = remoteOf(abs)
  const now = isoNow()
  const idx = setting.repositories.findIndex((r) => r.path === abs)

  let entry: RepoEntry
  if (idx >= 0) {
    entry = setting.repositories[idx]!
    entry.last_used_at = now
    entry.enabled = true
    if (!entry.git_remote && remote) entry.git_remote = remote
    if (!entry.alias) entry.alias = alias
    if (!entry.display_name.trim()) {
      entry.display_name = defaultDisplayName({ git_remote: entry.git_remote || remote, alias })
    }
  } else {
    entry = {
      path: abs,
      alias,
      display_name: defaultDisplayName({ git_remote: remote, alias }),
      git_remote: remote,
      enabled: true,
      added_at: now,
      last_used_at: now,
    }
    setting.repositories.push(entry)
  }

  if (!setting.git_user_email) {
    const author = tryExec('git config --get user.email')
    if (author) setting.git_user_email = author
  }
  writeSetting(setting)

  const author = setting.git_user_email || tryExec('git config --get user.email')
  const commits = collectSubjects(abs, opts.date, author)

  if (!commits.length) {
    return {
      ok: true,
      path: abs,
      alias: entry.alias,
      display_name: entry.display_name,
      git_remote: entry.git_remote,
      enabled: true,
      gather: null,
      commitCount: 0,
    }
  }

  const hours = repoSpanHours(commits)
  const project = entry.display_name || entry.alias || detectProject(abs)
  const gather: GatherRepo = {
    path: abs,
    alias: entry.alias,
    display_name: entry.display_name,
    project,
    commits: commits.map((c) => c.subject),
    hours,
  }

  return {
    ok: true,
    path: abs,
    alias: entry.alias,
    display_name: entry.display_name,
    git_remote: entry.git_remote,
    enabled: true,
    gather,
    commitCount: commits.length,
  }
}

/** 把 add_repo 结果合并进当日 GatherResult（同 path 覆盖） */
export function mergeGatherRepo(
  base: { date: string; repos: GatherRepo[]; sessionHours: number; commitCount: number },
  added: GatherRepo | null,
): void {
  if (!added) return
  const i = base.repos.findIndex((r) => r.path === added.path)
  if (i >= 0) {
    const old = base.repos[i]!
    base.commitCount -= old.commits.length
    base.repos[i] = added
  } else {
    base.repos.push(added)
  }
  base.commitCount += added.commits.length
  // sessionHours 是全日窗，不按仓累加/扣减
  if (base.commitCount < 0) base.commitCount = 0
}
