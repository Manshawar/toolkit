/** git 采集与工时 */
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import {
  DAY_CEILING,
  DAY_FLOOR,
  clampHm,
  hoursBetween,
} from '../config/work-hours'

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

/** 单仓：仅按该仓 commit 跨度（不拉满早晚），给 AI 分配参考 */
export function repoSpanHours(commits: Array<{ time: number }>): number {
  if (!commits.length) return 0
  const sorted = [...commits].sort((a, b) => a.time - b.time)
  const h = (sorted[sorted.length - 1]!.time - sorted[0]!.time) / 3600
  return Math.min(Math.max(Math.round(h * 2) / 2 || 0.5, 0.5), 6)
}

/**
 * 全日目标工时：以用户设定的上下班为准（不再被 commit 时间拉长）。
 * commits 参数保留兼容，不参与计算。
 */
export function daySessionHours(
  _commits: Array<{ time: number }>,
  _date: string,
  dayStartMax = '09:00',
  dayEndMin = '21:00',
): number {
  return hoursBetween(
    clampHm(dayStartMax, DAY_FLOOR, DAY_CEILING),
    clampHm(dayEndMin, DAY_FLOOR, DAY_CEILING),
  )
}

/** @deprecated 用 daySessionHours；保留别名避免旧引用 */
export function sessionHours(
  commits: Array<{ time: number }>,
  date: string,
  dayStartMax = '09:00',
  dayEndMin = '21:00',
): number {
  return daySessionHours(commits, date, dayStartMax, dayEndMin)
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
