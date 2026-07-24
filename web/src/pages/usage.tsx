import { useEffect, useState } from 'preact/hooks'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Badge } from '@web/components/ui/badge'
import { cn } from '@web/lib/utils'
import { fetchJson } from '@web/lib/api'

type UsagePeriod = 'day' | 'week' | 'month' | 'year'

type ToolUsageRow = {
  tool: string
  label: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

type AgentUsageStats = {
  period: UsagePeriod
  from: string
  to: string
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  tools: ToolUsageRow[]
}

type QuotaWindow = {
  label: string
  remainingPercent: number
  remainsMs?: number
  resetAt?: string
  used?: number
  total?: number
}

type UsageModel = {
  name: string
  windows: QuotaWindow[]
  meta?: Record<string, string>
}

type UsageSnapshot = {
  provider: string
  displayName: string
  fetchedAt: string
  models: UsageModel[]
}

type Health = {
  ok: boolean
  provider: string
  hasKey: boolean
  hint?: string
}

const PERIODS: { id: UsagePeriod; label: string }[] = [
  { id: 'day', label: '日' },
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
]

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('zh-CN')
}

function formatDuration(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return '—'
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function barTone(pct: number) {
  if (pct >= 60) return 'bg-success'
  if (pct >= 30) return 'bg-accent-warm'
  return 'bg-destructive'
}

export function UsagePage(_props: { path?: string }) {
  const [period, setPeriod] = useState<UsagePeriod>('day')
  const [agent, setAgent] = useState<AgentUsageStats | null>(null)
  const [agentMsg, setAgentMsg] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)

  const [snap, setSnap] = useState<UsageSnapshot | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [planMsg, setPlanMsg] = useState('')
  const [planBusy, setPlanBusy] = useState(false)

  async function loadAgent(p: UsagePeriod = period) {
    setAgentBusy(true)
    try {
      const data = await fetchJson<AgentUsageStats>(`/api/usage/agent?period=${p}`)
      setAgent(data)
      setAgentMsg('')
    } catch (e) {
      setAgent(null)
      setAgentMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setAgentBusy(false)
    }
  }

  async function loadPlan() {
    setPlanBusy(true)
    try {
      const h = await fetchJson<Health>('/api/usage/health')
      setHealth(h)
      if (!h.ok) {
        setSnap(null)
        setPlanMsg(h.hint || '未配置 API Key')
        return
      }
      const data = await fetchJson<UsageSnapshot>('/api/usage')
      setSnap(data)
      setPlanMsg('')
    } catch (e) {
      setSnap(null)
      setPlanMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPlanBusy(false)
    }
  }

  useEffect(() => {
    void loadAgent(period)
  }, [period])

  useEffect(() => {
    void loadPlan()
  }, [])

  const maxToolTokens = Math.max(1, ...(agent?.tools.map((t) => t.totalTokens) || [1]))

  return (
    <div class="mx-auto max-w-2xl space-y-10">
      <header class="space-y-1">
        <h1 class="font-display text-2xl font-bold tracking-tight">用量</h1>
        <p class="text-sm text-muted">本地 Agent 各工具消耗，以及云端 Token Plan 配额。</p>
      </header>

      <section class="space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="font-display text-lg font-bold tracking-tight">Agent 用量</h2>
            <p class="mt-0.5 text-xs text-muted">
              {agent
                ? `${new Date(agent.from).toLocaleString('zh-CN')} — ${new Date(agent.to).toLocaleString('zh-CN')}`
                : '按本地时区统计'}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <nav class="flex gap-0.5 rounded-xl border border-border/80 bg-card/80 p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  class={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    period === p.id
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted hover:bg-surface hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </nav>
            <Button
              variant="secondary"
              size="sm"
              disabled={agentBusy}
              onClick={() => void loadAgent(period)}
            >
              {agentBusy ? '刷新中…' : '刷新'}
            </Button>
          </div>
        </div>

        {agentMsg ? <p class="text-sm text-destructive">{agentMsg}</p> : null}

        {agent ? (
          <>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="调用" value={String(agent.calls)} />
              <Stat label="合计 Token" value={formatTokens(agent.totalTokens)} />
              <Stat label="输入" value={formatTokens(agent.inputTokens)} />
              <Stat label="输出" value={formatTokens(agent.outputTokens)} />
            </div>

            {agent.tools.length ? (
              <ul class="space-y-3">
                {agent.tools.map((t) => (
                  <li key={t.tool}>
                    <Card>
                      <CardHeader>
                        <CardTitle>{t.label}</CardTitle>
                        <Badge>{t.calls} 次</Badge>
                      </CardHeader>
                      <div class="mb-2 h-2 overflow-hidden rounded-full bg-surface">
                        <div
                          class="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.max(4, (t.totalTokens / maxToolTokens) * 100)}%`,
                          }}
                        />
                      </div>
                      <p class="text-xs text-muted">
                        合计 {formatTokens(t.totalTokens)} · 入{' '}
                        {formatTokens(t.inputTokens)} · 出 {formatTokens(t.outputTokens)}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="rounded-xl border border-dashed border-border/80 bg-card/40 px-4 py-8 text-center text-sm text-muted">
                本时段暂无 Agent 调用记录。跑一次 <code class="text-foreground">tkt gc</code> 或{' '}
                <code class="text-foreground">tkt report</code> 后会记在这里。
              </p>
            )}
          </>
        ) : !agentMsg ? (
          <p class="text-sm text-muted">加载中…</p>
        ) : null}
      </section>

      <section class="space-y-4 border-t border-border/60 pt-8">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 class="font-display text-lg font-bold tracking-tight">Token Plan</h2>
            <p class="mt-0.5 text-xs text-muted">
              {health?.provider || 'minimax'}
              {snap ? ` · 拉取于 ${new Date(snap.fetchedAt).toLocaleString('zh-CN')}` : ''}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={planBusy}
            onClick={() => void loadPlan()}
          >
            {planBusy ? '刷新中…' : '刷新配额'}
          </Button>
        </div>

        {planMsg ? (
          <p class={`text-sm ${snap ? 'text-muted' : 'text-destructive'}`}>{planMsg}</p>
        ) : null}

        {snap ? (
          <div class="space-y-4">
            {snap.models.map((m) => (
              <Card key={m.name}>
                <CardHeader>
                  <CardTitle>{m.name}</CardTitle>
                  {m.meta?.boost ? <Badge>{m.meta.boost}</Badge> : null}
                </CardHeader>
                <ul class="space-y-4">
                  {m.windows.map((w) => (
                    <li key={w.label}>
                      <div class="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                        <span class="font-medium">{w.label}</span>
                        <span class="tabular-nums text-muted">
                          {Math.round(w.remainingPercent)}% 剩余
                        </span>
                      </div>
                      <div class="h-2.5 overflow-hidden rounded-full bg-surface">
                        <div
                          class={`h-full rounded-full transition-all ${barTone(w.remainingPercent)}`}
                          style={{
                            width: `${Math.max(0, Math.min(100, w.remainingPercent))}%`,
                          }}
                        />
                      </div>
                      <p class="mt-1.5 text-xs text-muted">
                        {[
                          w.remainsMs != null ? `还剩 ${formatDuration(w.remainsMs)}` : null,
                          w.resetAt
                            ? `重置 ${new Date(w.resetAt).toLocaleString('zh-CN')}`
                            : null,
                          w.total && w.total > 0
                            ? `计数 ${w.used ?? 0}/${w.total}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        ) : !planMsg ? (
          <p class="text-sm text-muted">加载中…</p>
        ) : null}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="rounded-xl border border-border/80 bg-card/80 px-3 py-3">
      <p class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
      <p class="mt-1 font-display text-xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  )
}
