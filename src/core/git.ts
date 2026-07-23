/**
 * Git 薄封装（simple-git）。
 * Gerrit 判定偏保守，避免把普通 GitLab/GitHub remote 误判成 review 推送。
 */
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrl: string
  isGerrit: boolean
}

export function createGit(cwd = process.cwd()): SimpleGit {
  return simpleGit({
    baseDir: cwd,
    binary: 'git',
    maxConcurrentProcesses: 6,
    trimmed: true,
  } satisfies Partial<SimpleGitOptions>)
}

export async function ensureRepo(git: SimpleGit): Promise<string> {
  if (!(await git.checkIsRepo())) throw new Error('当前目录不是 git 仓库')
  return git.revparse(['--show-toplevel'])
}

export async function currentBranch(git?: SimpleGit): Promise<string> {
  const current = (await (git ?? createGit()).branch()).current
  if (!current) throw new Error('无法获取当前分支')
  return current
}

export async function pushOrigin(refspec: string, git?: SimpleGit): Promise<void> {
  await (git ?? createGit()).push('origin', refspec)
}

export async function listRemotes(git: SimpleGit): Promise<RemoteInfo[]> {
  const raw = await git.remote(['-v'])
  if (!raw) return []
  const map = new Map<string, RemoteInfo>()
  for (const line of raw.split('\n').filter(Boolean)) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
    if (!m) continue
    const [, name, url, kind] = m
    const cur = map.get(name) ?? { name, fetchUrl: '', pushUrl: '', isGerrit: false }
    if (kind === 'fetch') cur.fetchUrl = url
    else cur.pushUrl = url
    cur.isGerrit = isGerritUrl(cur.fetchUrl) || isGerritUrl(cur.pushUrl)
    map.set(name, cur)
  }
  return [...map.values()]
}

/** 仅明确 Gerrit 特征才返回 true（避免 code-review.git、GitLab /a/ 误伤） */
export function isGerritUrl(url: string): boolean {
  if (!url) return false
  if (/gerrit/i.test(url)) return true
  if (/:29418\b/.test(url)) return true // Gerrit SSH 默认端口
  if (/refs\/for\//i.test(url)) return true
  try {
    if (url.includes('://')) {
      const u = new URL(url)
      if (/(?:^|\.)gerrit\./i.test(u.hostname)) return true
      // HTTP 鉴权路径：.../a/<project>
      if (/^\/a\//.test(u.pathname)) return true
    }
  } catch {
    /* ssh host:path */
  }
  return false
}
