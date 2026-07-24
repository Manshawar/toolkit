import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import { PieChart } from '@web/pages/report/pie'
import type { ReportStats } from '@web/pages/report/types'

export function ReportOverviewPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ReportStats | null>(null)
  const [msg, setMsg] = useState('')
  const maxBar = useMemo(
    () => Math.max(1, ...(stats?.series.map((s) => s.hours) || [1])),
    [stats],
  )

  async function load() {
    try {
      setStats(await fetchJson<ReportStats>('/api/report/stats?days=30'))
      setMsg('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <ReportLayout path="/report">
      {msg ? <p className="text-sm text-destructive">{msg}</p> : null}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="归档天数" value={stats ? String(stats.days) : '—'} />
        <StatTile label="累计工时" value={stats ? `${stats.totalHours}h` : '—'} accent />
        <StatTile label="日均" value={stats ? `${stats.avgHours}h` : '—'} />
        <StatTile label="commits" value={stats ? String(stats.totalCommits) : '—'} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>任务分布</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              刷新
            </Button>
          </CardHeader>
          {!stats?.projects.length ? (
            <p className="py-6 text-center text-sm text-muted">暂无项目数据</p>
          ) : (
            <PieChart
              slices={stats.projects.map((p) => ({ name: p.name, value: p.hours }))}
            />
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>近 30 天工时</CardTitle>
          </CardHeader>
          {!stats?.series.some((s) => s.hours > 0) ? (
            <p className="py-6 text-center text-sm text-muted">暂无数据</p>
          ) : (
            <div className="flex h-36 items-end gap-[3px]">
              {stats.series.map((s) => {
                const h = s.hours > 0 ? Math.max(8, (s.hours / maxBar) * 100) : 0
                return (
                  <div
                    key={s.date}
                    className="group relative flex min-w-0 flex-1 flex-col justify-end"
                    title={`${s.date} · ${s.hours}h`}
                  >
                    <div
                      className={`w-full max-w-[14px] rounded-t-sm ${
                        s.hours > 0 ? 'bg-primary/85 group-hover:bg-primary' : 'bg-surface'
                      }`}
                      style={{ height: `${h}%`, minHeight: s.hours > 0 ? undefined : 2 }}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近归档</CardTitle>
          <Button variant="secondary" size="sm" onClick={() => navigate('/report/history')}>
            全部 →
          </Button>
        </CardHeader>
        <ul className="divide-y divide-border/70">
          {(stats?.recent || []).slice(0, 5).map((r) => (
            <li key={r.date}>
              <a
                href={`/report/history/${r.date}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm no-underline hover:text-primary"
                onClick={(e) => {
                  e.preventDefault()
                  navigate(`/report/history/${r.date}`)
                }}
              >
                <span className="font-medium tabular-nums">{r.date}</span>
                <span className="text-muted">
                  {r.role} · {r.totalHours}h · {r.items.length} 条
                </span>
              </a>
            </li>
          ))}
          {!stats?.recent.length ? (
            <li className="py-4 text-sm text-muted">
              尚无归档，去{' '}
              <a
                href="/report/generate"
                className="text-primary no-underline hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  navigate('/report/generate')
                }}
              >
                生成
              </a>{' '}
              今天的日报
            </li>
          ) : null}
        </ul>
      </Card>
    </ReportLayout>
  )
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-2xl border border-border/80 bg-card/90 px-4 py-4 ${
        accent ? 'ring-1 ring-primary/15' : ''
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p
        className={`mt-2 font-display text-2xl font-bold tabular-nums ${
          accent ? 'text-primary' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}
