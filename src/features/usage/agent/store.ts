/**
 * 本地 Agent 用量事件：~/.config/tkt/usage/events.jsonl
 */
import * as fs from 'fs'
import * as path from 'path'
import { dataDir, ensureDataDir } from '@/core/paths'

export type AgentUsageEvent = {
  ts: string
  tool: string
  model?: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

const DIR = 'usage'
const FILE = 'events.jsonl'
/** 超过此天数的事件在写入时偶尔裁剪 */
const RETAIN_DAYS = 800

function eventsPath(): string {
  return path.join(dataDir(DIR), FILE)
}

export function appendAgentUsage(event: Omit<AgentUsageEvent, 'ts'> & { ts?: string }): void {
  try {
    ensureDataDir(DIR)
    const row: AgentUsageEvent = {
      ts: event.ts ?? new Date().toISOString(),
      tool: event.tool,
      model: event.model,
      inputTokens: Math.max(0, Math.floor(event.inputTokens || 0)),
      outputTokens: Math.max(0, Math.floor(event.outputTokens || 0)),
      totalTokens: Math.max(0, Math.floor(event.totalTokens || 0)),
    }
    fs.appendFileSync(eventsPath(), `${JSON.stringify(row)}\n`, 'utf8')
    // 约 2% 写入时裁剪，避免每次 IO
    if (Math.random() < 0.02) pruneOldEvents()
  } catch {
    /* 用量记账失败不阻断主流程 */
  }
}

export function readAgentUsageEvents(): AgentUsageEvent[] {
  const p = eventsPath()
  if (!fs.existsSync(p)) return []
  try {
    const text = fs.readFileSync(p, 'utf8')
    const out: AgentUsageEvent[] = []
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const row = JSON.parse(t) as AgentUsageEvent
        if (!row?.ts || !row.tool) continue
        out.push({
          ts: row.ts,
          tool: String(row.tool),
          model: row.model ? String(row.model) : undefined,
          inputTokens: Number(row.inputTokens) || 0,
          outputTokens: Number(row.outputTokens) || 0,
          totalTokens: Number(row.totalTokens) || 0,
        })
      } catch {
        /* skip bad line */
      }
    }
    return out
  } catch {
    return []
  }
}

function pruneOldEvents(): void {
  const cutoff = Date.now() - RETAIN_DAYS * 86400_000
  const kept = readAgentUsageEvents().filter((e) => {
    const t = Date.parse(e.ts)
    return Number.isFinite(t) && t >= cutoff
  })
  try {
    ensureDataDir(DIR)
    fs.writeFileSync(
      eventsPath(),
      kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''),
      'utf8',
    )
  } catch {
    /* ignore */
  }
}
