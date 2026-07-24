/**
 * Agent 用量按日 / 周 / 月 / 年聚合（本地时区）
 */
import { readAgentUsageEvents, type AgentUsageEvent } from './store'

export type UsagePeriod = 'day' | 'week' | 'month' | 'year'

export type ToolUsageRow = {
  tool: string
  label: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type AgentUsageStats = {
  period: UsagePeriod
  from: string
  to: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  tools: ToolUsageRow[]
}

const TOOL_LABELS: Record<string, string> = {
  gc: '提交 (gc)',
  report: '日报',
  'report.guess-name': '日报·猜名',
}

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] || tool
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 周一为一周起点 */
function startOfLocalWeek(d: Date): Date {
  const day = startOfLocalDay(d)
  const dow = day.getDay() // 0 Sun … 6 Sat
  const offset = dow === 0 ? 6 : dow - 1
  day.setDate(day.getDate() - offset)
  return day
}

function startOfLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function startOfLocalYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

export function periodRange(period: UsagePeriod, now = new Date()): { from: Date; to: Date } {
  const to = now
  let from: Date
  switch (period) {
    case 'day':
      from = startOfLocalDay(now)
      break
    case 'week':
      from = startOfLocalWeek(now)
      break
    case 'month':
      from = startOfLocalMonth(now)
      break
    case 'year':
      from = startOfLocalYear(now)
      break
    default:
      from = startOfLocalDay(now)
  }
  return { from, to }
}

function sumEvents(events: AgentUsageEvent[]): Omit<ToolUsageRow, 'tool' | 'label'> {
  let calls = 0
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  for (const e of events) {
    calls += 1
    inputTokens += e.inputTokens
    outputTokens += e.outputTokens
    totalTokens += e.totalTokens || e.inputTokens + e.outputTokens
  }
  return { calls, inputTokens, outputTokens, totalTokens }
}

export function aggregateAgentUsage(
  period: UsagePeriod,
  now = new Date(),
): AgentUsageStats {
  const { from, to } = periodRange(period, now)
  const fromMs = from.getTime()
  const toMs = to.getTime()
  const events = readAgentUsageEvents().filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= fromMs && t <= toMs
  })

  const byTool = new Map<string, AgentUsageEvent[]>()
  for (const e of events) {
    const list = byTool.get(e.tool) || []
    list.push(e)
    byTool.set(e.tool, list)
  }

  const tools: ToolUsageRow[] = [...byTool.entries()]
    .map(([tool, list]) => ({
      tool,
      label: toolLabel(tool),
      ...sumEvents(list),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.calls - a.calls)

  const totals = sumEvents(events)
  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    ...totals,
    tools,
  }
}

export function parsePeriod(raw: string | undefined): UsagePeriod {
  const v = (raw || 'day').toLowerCase()
  if (v === 'day' || v === 'week' || v === 'month' || v === 'year') return v
  return 'day'
}
