/** 日报归档读写与汇总 */
import * as fs from 'fs'
import * as path from 'path'
import { historyDir } from '../setting'
import type { ReportRecord } from '../types'

function isRecord(v: unknown): v is ReportRecord {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.date === 'string' && Array.isArray(o.items)
}

/** 列出归档（新→旧） */
export function listHistory(): ReportRecord[] {
  const dir = historyDir()
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
  const out: ReportRecord[] = []
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as unknown
      if (isRecord(raw)) out.push(raw)
    } catch {
      /* skip bad file */
    }
  }
  return out
}

export function loadHistory(date: string): ReportRecord | null {
  const file = path.join(historyDir(), `${date}.json`)
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return isRecord(raw) ? raw : null
  } catch {
    return null
  }
}

export type ReportStats = {
  days: number
  totalHours: number
  avgHours: number
  totalCommits: number
  lastDate: string | null
  /** 最近日历日（含无归档日填 0），供折线/柱图 */
  series: Array<{ date: string; hours: number; commits: number }>
  /** 项目累计工时 top */
  projects: Array<{ name: string; hours: number; days: number }>
  recent: ReportRecord[]
}

/** 汇总统计；seriesDays 默认近 30 天日历窗 */
export function summarizeHistory(
  records: ReportRecord[],
  opts: { seriesDays?: number; recentLimit?: number } = {},
): ReportStats {
  const seriesDays = Math.max(7, Math.min(90, opts.seriesDays ?? 30))
  const recentLimit = Math.max(1, Math.min(60, opts.recentLimit ?? 14))

  const byDate = new Map(records.map((r) => [r.date, r]))
  const totalHours = records.reduce((s, r) => s + (Number(r.totalHours) || 0), 0)
  const totalCommits = records.reduce((s, r) => s + (Number(r.commitCount) || 0), 0)
  const days = records.length

  const projectMap = new Map<string, { hours: number; days: Set<string> }>()
  for (const r of records) {
    for (const it of r.items || []) {
      const name = (it.project || '通用').trim() || '通用'
      let row = projectMap.get(name)
      if (!row) {
        row = { hours: 0, days: new Set() }
        projectMap.set(name, row)
      }
      row.hours += Number(it.hours) || 0
      row.days.add(r.date)
    }
  }
  const projects = [...projectMap.entries()]
    .map(([name, v]) => ({ name, hours: Math.round(v.hours * 10) / 10, days: v.days.size }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 12)

  const today = new Date()
  const series: ReportStats['series'] = []
  for (let i = seriesDays - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const rec = byDate.get(key)
    series.push({
      date: key,
      hours: rec ? Number(rec.totalHours) || 0 : 0,
      commits: rec ? Number(rec.commitCount) || 0 : 0,
    })
  }

  return {
    days,
    totalHours: Math.round(totalHours * 10) / 10,
    avgHours: days ? Math.round((totalHours / days) * 10) / 10 : 0,
    totalCommits,
    lastDate: records[0]?.date ?? null,
    series,
    projects,
    recent: records.slice(0, recentLimit),
  }
}
