/** 格式化分点、JSON 归档、剪贴板 */
import * as fs from 'fs'
import * as path from 'path'
import clipboard from 'clipboardy'
import { historyDir, isoNow } from '../setting'
import type { DailyPlan, ReportRecord } from '../types'

function copyToClipboard(text: string): { ok: boolean; detail?: string } {
  try {
    clipboard.writeSync(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }
}

export function halfHour(n: number): number {
  return Math.min(4, Math.max(0.5, Math.round(n * 2) / 2))
}

/** 粘贴用工时表的纯分点文本（不进归档） */
export function formatDaily(plan: DailyPlan): string {
  return plan.items
    .map((it, i) => {
      const h = halfHour(it.hours)
      const hs = Number.isInteger(h) ? String(h) : h.toFixed(1)
      const text = it.text.trim().replace(/[。.]+$/, '')
      return `${i + 1}. 【${it.project.trim()}】${text}。- ${hs}小时`
    })
    .join('\n')
}

export function normalizeSheetTime(raw: string): string {
  let s = raw.replace(/^sheetTime:\s*/i, '').trim()
  if ([...s].length > 80) s = [...s].slice(0, 79).join('') + '…'
  return s
}

export function assertPlan(plan: DailyPlan, targetHours: number): void {
  let total = 0
  for (const it of plan.items) total += halfHour(it.hours)
  if (total + 1e-6 < targetHours) {
    throw new Error(`总工时 ${total}h < 目标 ${targetHours}h`)
  }
  const sheet = normalizeSheetTime(plan.sheetTime)
  if (!sheet || /[\n\r【]|小时/.test(sheet)) {
    throw new Error('sheetTime 非法：须单行、无【】、无「小时」')
  }
}

export function buildRecord(input: {
  plan: DailyPlan
  date: string
  role: string
  targetHours: number
  sessionHours: number
  commitCount: number
}): ReportRecord {
  const items = input.plan.items.map((it) => ({
    project: it.project.trim() || '通用',
    text: it.text.trim().replace(/[。.]+$/, ''),
    hours: halfHour(it.hours),
  }))
  const totalHours = items.reduce((s, it) => s + it.hours, 0)
  return {
    date: input.date,
    role: input.role,
    sheetTime: normalizeSheetTime(input.plan.sheetTime),
    items,
    totalHours,
    targetHours: input.targetHours,
    sessionHours: input.sessionHours,
    commitCount: input.commitCount,
    emittedAt: isoNow(),
  }
}

/** 归档为 ~/.config/tkt/report/history/YYYY-MM-DD.json */
export function saveHistory(record: ReportRecord): string {
  fs.mkdirSync(historyDir(), { recursive: true })
  const file = path.join(historyDir(), `${record.date}.json`)
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8')
  return file
}

export function deliver(opts: {
  plan: DailyPlan
  date: string
  role: string
  targetHours: number
  sessionHours: number
  commitCount: number
  autoCopy: boolean
  noClipboard?: boolean
  print?: boolean
}): {
  record: ReportRecord
  dailyText: string
  historyFile: string | null
  copied: boolean
} {
  const record = buildRecord(opts)
  const planForText: DailyPlan = {
    items: record.items,
    sheetTime: record.sheetTime,
    displayNames: opts.plan.displayNames,
  }
  const dailyText = formatDaily(planForText)
  const sheetLine = `sheetTime: ${record.sheetTime}`

  if (opts.print !== false) {
    console.log(sheetLine)
    console.log('')
    console.log(dailyText)
  }

  let historyFile: string | null = null
  try {
    historyFile = saveHistory(record)
    console.error(`✅ 已归档 ${historyFile}`)
  } catch (e) {
    console.error(`⚠️ 归档失败: ${e instanceof Error ? e.message : e}`)
  }

  let copied = false
  if (opts.autoCopy && !opts.noClipboard) {
    const { ok, detail } = copyToClipboard(dailyText)
    if (ok) {
      copied = true
      console.error('✅ 已复制分点到剪贴板')
    } else console.error(`⚠️ 剪贴板失败: ${detail}`)
  }

  return { record, dailyText, historyFile, copied }
}
