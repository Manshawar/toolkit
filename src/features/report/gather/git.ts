/** git 采集与工时 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'

export function tryExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
  }
}

export function isGitRepo(dir: string): boolean {
  return Boolean(tryExec(`git -C "${dir}" rev-parse --git-dir`))
}

export function collectSubjects(
  repo: string,
  date: string,
  author: string,
): Array<{ time: number; subject: string }> {
  const authorArg = author ? `--author="${author}"` : ''
  const raw = tryExec(
    `git -C "${repo}" log --since="${date} 00:00:00" --until="${date} 23:59:59" --no-merges --pretty=format:"%ct|%s" ${authorArg}`,
  )
  if (!raw) return []
  return raw
    .split('\n')
    .filter((l) => l.includes('|'))
    .map((line) => {
      const [ts, ...rest] = line.split('|')
      return { time: parseInt(ts!, 10), subject: rest.join('|').trim() }
    })
    .filter((c) => !Number.isNaN(c.time) && !/^(Merge|Revert )/.test(c.subject))
}

/** 黑心窗：起点≤dayStartMax，终点≥dayEndMin；半小时粒度；[0.5,14] */
export function sessionHours(
  commits: Array<{ time: number }>,
  date: string,
  dayStartMax = '09:30',
  dayEndMin = '20:30',
): number {
  if (!commits.length) return 0
  const sorted = [...commits].sort((a, b) => a.time - b.time)
  const startHH = /^\d{1,2}:\d{2}$/.test(dayStartMax) ? dayStartMax : '09:30'
  const endHH = /^\d{1,2}:\d{2}$/.test(dayEndMin) ? dayEndMin : '20:30'
  const capStart = Math.floor(new Date(`${date}T${startHH}:00`).getTime() / 1000)
  const capEnd = Math.floor(new Date(`${date}T${endHH}:00`).getTime() / 1000)
  const start = Math.min(sorted[0]!.time, capStart)
  const end = Math.max(sorted[sorted.length - 1]!.time, capEnd)
  const h = Math.round(((end - start) / 3600) * 2) / 2
  return Math.min(Math.max(h, 0.5), 14)
}

export function detectProject(repo: string): string {
  try {
    const pkg = path.join(repo, 'package.json')
    if (fs.existsSync(pkg)) {
      const name = (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string }).name
      if (name) return name
    }
  } catch {
    /* ignore */
  }
  const remote = tryExec(`git -C "${repo}" config --get remote.origin.url`)
  if (remote) return path.basename(remote.replace(/\.git$/, ''))
  return path.basename(repo)
}
