import { useEffect, useState } from 'react'
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

export function UsagePage() {
  const [period, setPeriod] = useState<UsagePeriod>('day')
  const [agent, setAgent] = useState<AgentUsageStats | null>(null)
  const [agentMsg, setAgentMsg] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)

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

  useEffect(() => {
    void loadAgent(period)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const maxToolTokens = Math.max(1, ...(agent?.tools.map((t) => t.totalTokens) || [1]))

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">用量</h1>
        <p className="text-sm text-muted">本地 Agent 各工具消耗。</p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Agent 用量</h2>
            <p className="mt-0.5 text-xs text-muted">
              {agent
                ? `${new Date(agent.from).toLocaleString('zh-CN')} — ${new Date(agent.to).toLocaleString('zh-CN')}`
                : '按本地时区统计'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex gap-0.5 rounded-xl border border-border/80 bg-card/80 p-1">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={cn(
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

        {agentMsg ? <p className="text-sm text-destructive">{agentMsg}</p> : null}

        {agent ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="调用" value={String(agent.calls)} />
              <Stat label="合计 Token" value={formatTokens(agent.totalTokens)} />
              <Stat label="输入" value={formatTokens(agent.inputTokens)} />
              <Stat label="输出" value={formatTokens(agent.outputTokens)} />
            </div>

            {agent.tools.length ? (
              <ul className="space-y-3">
                {agent.tools.map((t) => (
                  <li key={t.tool}>
                    <Card>
                      <CardHeader>
                        <CardTitle>{t.label}</CardTitle>
                        <Badge>{t.calls} 次</Badge>
                      </CardHeader>
                      <div className="mb-2 h-2 overflow-hidden rounded-full bg-surface">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.max(4, (t.totalTokens / maxToolTokens) * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted">
                        合计 {formatTokens(t.totalTokens)} · 入{' '}
                        {formatTokens(t.inputTokens)} · 出 {formatTokens(t.outputTokens)}
                      </p>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-border/80 bg-card/40 px-4 py-8 text-center text-sm text-muted">
                本时段暂无 Agent 调用记录。跑一次 <code className="text-foreground">tkt gc</code> 或{' '}
                <code className="text-foreground">tkt report</code> 后会记在这里。
              </p>
            )}
          </>
        ) : !agentMsg ? (
          <p className="text-sm text-muted">加载中…</p>
        ) : null}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/80 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  )
}
