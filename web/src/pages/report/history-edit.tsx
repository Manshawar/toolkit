import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import { PieChart } from '@web/pages/report/pie'
import type { ReportItem, ReportRecord } from '@web/pages/report/types'

/** 与后端 deliver.formatDaily 对齐，供粘贴用工时表 */
function halfHour(n: number): number {
  return Math.min(4, Math.max(0.5, Math.round(n * 2) / 2))
}

function formatDaily(items: ReportItem[]): string {
  return items
    .map((it, i) => {
      const h = halfHour(Number(it.hours) || 0.5)
      const hs = Number.isInteger(h) ? String(h) : h.toFixed(1)
      const text = String(it.text || '')
        .trim()
        .replace(/[。.]+$/, '')
      return `${i + 1}. 【${String(it.project || '').trim()}】${text}。- ${hs}小时`
    })
    .join('\n')
}

export function ReportHistoryEditPage() {
  const { date: dateParam = '' } = useParams<{ date: string }>()
  const date = dateParam
  const navigate = useNavigate()
  const [rec, setRec] = useState<ReportRecord | null>(null)
  const [sheetTime, setSheetTime] = useState('')
  const [items, setItems] = useState<ReportItem[]>([])
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copyMsg, setCopyMsg] = useState('')

  const pieSlices = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of items) {
      const name = it.project || '通用'
      map.set(name, (map.get(name) || 0) + (Number(it.hours) || 0))
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }))
  }, [items])

  const total = useMemo(
    () => Math.round(items.reduce((s, it) => s + (Number(it.hours) || 0), 0) * 10) / 10,
    [items],
  )

  const dailyText = useMemo(() => formatDaily(items), [items])

  async function load() {
    if (!date) return
    try {
      const data = await fetchJson<ReportRecord>(`/api/report/history/${date}`)
      setRec(data)
      setSheetTime(data.sheetTime || '')
      setItems(data.items.map((it) => ({ ...it })))
      setOk(true)
      setMsg('')
      setCopyMsg('')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function save() {
    setBusy(true)
    try {
      const data = await fetchJson<{ record: ReportRecord; dailyText?: string }>(
        `/api/report/history/${date}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sheetTime, items }),
        },
      )
      setRec(data.record)
      setItems(data.record.items)
      setOk(true)
      setMsg('已保存')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copyDaily() {
    if (!dailyText.trim()) {
      setCopyMsg('暂无可复制内容')
      return
    }
    try {
      await navigator.clipboard.writeText(dailyText)
      setCopyMsg('已复制到剪贴板')
    } catch (e) {
      setCopyMsg(e instanceof Error ? e.message : '复制失败')
    }
  }

  useEffect(() => {
    void load()
  }, [date])

  return (
    <ReportLayout path={`/report/history/${date}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/report/history')}>
          ← 归档列表
        </Button>
        <p className="font-display text-lg font-bold tabular-nums">{date}</p>
      </div>

      {msg ? (
        <p className={`text-sm ${ok ? 'text-success' : 'text-destructive'}`}>{msg}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>编辑 · 合计 {total}h</CardTitle>
            <Button disabled={busy} onClick={() => void save()}>
              保存
            </Button>
          </CardHeader>
          <div className="mb-4 space-y-1.5">
            <Label>sheetTime</Label>
            <Input
              value={sheetTime}
              onInput={(e) => setSheetTime((e.target as HTMLInputElement).value)}
            />
          </div>
          <ul className="space-y-3">
            {items.map((it, idx) => (
              <li
                key={idx}
                className="rounded-xl border border-border/70 bg-background/40 p-3 space-y-2"
              >
                <div className="grid gap-2 sm:grid-cols-[1fr_5.5rem]">
                  <Input
                    value={it.project}
                    placeholder="项目"
                    onInput={(e) => {
                      const v = (e.target as HTMLInputElement).value
                      setItems((list) =>
                        list.map((x, i) => (i === idx ? { ...x, project: v } : x)),
                      )
                    }}
                  />
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={it.hours}
                    onInput={(e) => {
                      const v = Number((e.target as HTMLInputElement).value) || 0.5
                      setItems((list) =>
                        list.map((x, i) => (i === idx ? { ...x, hours: v } : x)),
                      )
                    }}
                  />
                </div>
                <Input
                  value={it.text}
                  placeholder="任务描述"
                  onInput={(e) => {
                    const v = (e.target as HTMLInputElement).value
                    setItems((list) =>
                      list.map((x, i) => (i === idx ? { ...x, text: v } : x)),
                    )
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((list) => list.filter((_, i) => i !== idx))}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setItems((list) => [...list, { project: '通用', text: '', hours: 0.5 }])
              }
            >
              加一条
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              保存修改
            </Button>
          </div>
          {rec ? (
            <p className="mt-3 text-xs text-muted">
              角色 {rec.role} · 目标 {rec.targetHours}h · commits {rec.commitCount}
            </p>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>剪切板</CardTitle>
              <Button size="sm" variant="secondary" onClick={() => void copyDaily()}>
                复制
              </Button>
            </CardHeader>
            {copyMsg ? (
              <p className="mb-2 text-xs text-muted">{copyMsg}</p>
            ) : (
              <p className="mb-2 text-xs text-muted">
                粘贴用工时表格式，随左侧编辑实时更新（不含 sheetTime）
              </p>
            )}
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-surface/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-foreground">
              {dailyText.trim() ? dailyText : '暂无条目'}
            </pre>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>当日任务分布</CardTitle>
            </CardHeader>
            {!pieSlices.length ? (
              <p className="text-sm text-muted">无条目</p>
            ) : (
              <PieChart slices={pieSlices} size={160} />
            )}
          </Card>
        </div>
      </div>
    </ReportLayout>
  )
}
