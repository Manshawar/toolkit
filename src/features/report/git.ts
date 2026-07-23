/** git / 工时工具 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import type { CommitItem } from './types'

export function tryExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

export function isGitRepo(repoPath: string): boolean {
  return Boolean(tryExec(`git -C "${repoPath}" rev-parse --git-dir`))
}

export function detectProject(repoPath: string): string {
  let files: string[]
  try {
    files = fs.readdirSync(repoPath)
  } catch {
    return path.basename(repoPath)
  }

  if (files.includes('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')) as {
        name?: string
      }
      if (pkg.name) return pkg.name
    } catch {
      /* ignore */
    }
  }

  if (files.includes('pom.xml')) {
    const pom = fs.readFileSync(path.join(repoPath, 'pom.xml'), 'utf8')
    const nameMatch = pom.match(/<name>([^<]+)<\/name>/)
    if (nameMatch?.[1]) return nameMatch[1]
    const artMatch = pom.match(/<artifactId>([^<]+)<\/artifactId>/)
    if (artMatch?.[1]) return artMatch[1]
  }

  for (const f of ['settings.gradle', 'settings.gradle.kts']) {
    if (files.includes(f)) {
      const content = fs.readFileSync(path.join(repoPath, f), 'utf8')
      const match = content.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/)
      if (match?.[1]) return match[1]
    }
  }

  if (files.includes('pyproject.toml')) {
    const content = fs.readFileSync(path.join(repoPath, 'pyproject.toml'), 'utf8')
    const match = content.match(/^name\s*=\s*"([^"]+)"/m)
    if (match?.[1]) return match[1]
  }

  if (files.includes('Cargo.toml')) {
    const content = fs.readFileSync(path.join(repoPath, 'Cargo.toml'), 'utf8')
    const match = content.match(/^name\s*=\s*"([^"]+)"/m)
    if (match?.[1]) return match[1]
  }

  if (files.includes('README.md')) {
    try {
      const lines = fs.readFileSync(path.join(repoPath, 'README.md'), 'utf8').split('\n').slice(0, 20)
      for (const line of lines) {
        const m = line.match(/^#\s+(.+)/)
        if (m?.[1]) return m[1].trim()
      }
    } catch {
      /* ignore */
    }
  }

  const remote = tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
  if (remote) {
    const base = path.basename(remote.replace(/\.git$/, ''))
    if (base) return base
  }

  return path.basename(repoPath)
}

export function collectCommits(repoPath: string, date: string, author: string): CommitItem[] {
  const since = `${date} 00:00:00`
  const until = `${date} 23:59:59`
  const authorArg = author ? `--author="${author}"` : ''
  const cmd = `git -C "${repoPath}" log --since="${since}" --until="${until}" --no-merges --pretty=format:"%ct|%s" ${authorArg}`
  const raw = tryExec(cmd)
  if (!raw) return []

  return raw
    .split('\n')
    .filter((line) => line.trim() && line.includes('|'))
    .filter((line) => !/^Merge|^Revert /.test(line.split('|')[1] || ''))
    .map((line) => {
      const [ts, ...rest] = line.split('|')
      return { time: parseInt(ts!, 10), subject: rest.join('|').trim() }
    })
    .filter((c) => !Number.isNaN(c.time))
}

/** 黑心窗：只能多不能少；半小时粒度；cap [0.5, 14] */
export function computeSessionHours(
  commits: CommitItem[],
  date: string,
  dayStartMaxStr = '09:30',
  dayEndMinStr = '20:30',
): number {
  if (commits.length === 0) return 0

  const sorted = [...commits].sort((a, b) => a.time - b.time)
  const first = sorted[0]!.time
  const last = sorted[sorted.length - 1]!.time

  const startHHMM = /^\d{1,2}:\d{2}$/.test(dayStartMaxStr) ? dayStartMaxStr : '09:30'
  const endHHMM = /^\d{1,2}:\d{2}$/.test(dayEndMinStr) ? dayEndMinStr : '20:30'
  const dayStartMax = new Date(`${date}T${startHHMM}:00`)
  const dayEndMin = new Date(`${date}T${endHHMM}:00`)

  const startSec = Math.min(first, Math.floor(dayStartMax.getTime() / 1000))
  const endSec = Math.max(last, Math.floor(dayEndMin.getTime() / 1000))

  const hours = (endSec - startSec) / 3600
  const halfHour = Math.round(hours * 2) / 2
  return Math.min(Math.max(halfHour, 0.5), 14)
}
