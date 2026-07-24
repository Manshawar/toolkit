import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Badge } from '@web/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import type { ReportRecord } from '@web/pages/report/types'

export function ReportHistoryListPage(_props: { path?: string }) {
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void fetchJson<{ records: ReportRecord[] }>('/api/report/history?limit=60')
      .then((d) => setRecords(d.records || []))
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <ReportLayout path="/report/history">
      {msg ? <p class="text-sm text-destructive">{msg}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>归档列表</CardTitle>
          <span class="text-xs text-muted">{records.length} 天</span>
        </CardHeader>
        {!records.length ? (
          <p class="text-sm text-muted">暂无归档</p>
        ) : (
          <ul class="divide-y divide-border/70">
            {records.map((r) => (
              <li key={r.date}>
                <a
                  href={`/report/history/${r.date}`}
                  class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm no-underline hover:text-primary"
                  onClick={(e) => {
                    e.preventDefault()
                    route(`/report/history/${r.date}`)
                  }}
                >
                  <span class="font-medium tabular-nums">{r.date}</span>
                  <span class="flex items-center gap-2 text-muted">
                    <Badge>{r.role || '—'}</Badge>
                    <span class="tabular-nums">{r.totalHours}h</span>
                    <span>{r.items.length} 条</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ReportLayout>
  )
}
