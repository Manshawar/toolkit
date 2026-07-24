import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@web/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import type { ReportRecord } from '@web/pages/report/types'

export function ReportHistoryListPage() {
  const navigate = useNavigate()
  const [records, setRecords] = useState<ReportRecord[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void fetchJson<{ records: ReportRecord[] }>('/api/report/history?limit=60')
      .then((d) => setRecords(d.records || []))
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <ReportLayout path="/report/history">
      {msg ? <p className="text-sm text-destructive">{msg}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>归档列表</CardTitle>
          <span className="text-xs text-muted">{records.length} 天</span>
        </CardHeader>
        {!records.length ? (
          <p className="text-sm text-muted">暂无归档</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {records.map((r) => (
              <li key={r.date}>
                <a
                  href={`/report/history/${r.date}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm no-underline hover:text-primary"
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(`/report/history/${r.date}`)
                  }}
                >
                  <span className="font-medium tabular-nums">{r.date}</span>
                  <span className="flex items-center gap-2 text-muted">
                    <Badge>{r.role || '—'}</Badge>
                    <span className="tabular-nums">{r.totalHours}h</span>
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
