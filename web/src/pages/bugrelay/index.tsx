import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { fetchJson, readSse } from '@web/lib/api'
import { cn } from '@web/lib/utils'
import { DataPanels, type Snapshot } from './panels'

export type SessionItem = {
  sessionId: string
  online: boolean
  page: { url?: string; title?: string; ua?: string; lanxinVer?: string; net?: string }
  route?: string
  caps: string[]
  lastActive: number
  unreadErrors: number
  eventCount: number
  hasSnapshot: boolean
}

export type Analysis = {
  attribution: 'frontend' | 'backend' | 'uncertain'
  confidence: number
  summary: string
  evidence: string[]
  suggestions: string[]
  routes: string[]
  files: string[]
}

const ATTRIBUTION_META: Record<Analysis['attribution'], { label: string; cls: string }> = {
  frontend: { label: '前端', cls: 'bg-[#c44536] text-white' },
  backend: { label: '后端', cls: 'bg-[#457b9d] text-white' },
  uncertain: { label: '待定位', cls: 'bg-muted/30 text-muted' },
}

type ProgressEvent = { stage: string; tool?: string; round?: number }

function stageText(e: ProgressEvent): string {
  if (e.stage === 'snapshot') return '正在拉取页面快照…'
  if (e.stage === 'analyzing') return 'AI 分析中…'
  if (e.stage === 'tool') return `AI 自助拉取 #${e.round}（${e.tool}）…`
  return ''
}

export function BugrelayPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [listError, setListError] = useState('')
  const [activeId, setActiveId] = useState('')
  const [question, setQuestion] = useState('')

  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [analyzeError, setAnalyzeError] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [snapshotAt, setSnapshotAt] = useState(0)
  const [snapshotMsg, setSnapshotMsg] = useState('')

  const [report, setReport] = useState('')
  const [reportMsg, setReportMsg] = useState('')

  const activeRef = useRef(activeId)
  activeRef.current = activeId

  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchJson<{ sessions: SessionItem[] }>('/bugrelay/api/sessions')
      setSessions(data.sessions)
      setListError('')
      // 首次自动选中第一个在线会话
      if (!activeRef.current && data.sessions.length) {
        const online = data.sessions.find((s) => s.online) ?? data.sessions[0]
        setActiveId(online.sessionId)
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadSessions()
    const timer = setInterval(() => void loadSessions(), 3000)
    return () => clearInterval(timer)
  }, [loadSessions])

  const active = sessions.find((s) => s.sessionId === activeId)

  async function pullSnapshot() {
    if (!activeId) return
    setSnapshotMsg('拉取中…')
    try {
      const data = await fetchJson<{ snapshot: Snapshot; snapshotAt: number }>(
        `/bugrelay/api/snapshot?sessionId=${encodeURIComponent(activeId)}&pull=1&full=1`,
      )
      setSnapshot(data.snapshot)
      setSnapshotAt(data.snapshotAt)
      setSnapshotMsg('')
    } catch (e) {
      setSnapshotMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function runAnalyze() {
    if (!activeId || !question.trim() || busy) return
    setBusy(true)
    setAnalyzeError('')
    setAnalysis(null)
    setReport('')
    setProgress('连接分析服务…')
    try {
      const res = await fetch('/bugrelay/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeId, question: question.trim() }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      await readSse(res, (event, raw) => {
        const data = raw as ProgressEvent & { analysis?: Analysis; error?: string }
        if (event === 'progress') setProgress(stageText(data))
        if (event === 'done' && data.analysis) {
          setAnalysis(data.analysis)
          setProgress('')
        }
        if (event === 'error') setAnalyzeError(data.error ?? '分析失败')
      })
      // 分析结束顺手刷新数据面板
      void fetchJson<{ snapshot: Snapshot; snapshotAt: number }>(
        `/bugrelay/api/snapshot?sessionId=${encodeURIComponent(activeId)}&full=1`,
      )
        .then((d) => {
          setSnapshot(d.snapshot)
          setSnapshotAt(d.snapshotAt)
        })
        .catch(() => {})
    } catch (e) {
      setAnalyzeError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  async function buildReport() {
    if (!activeId || !analysis) return
    try {
      const data = await fetchJson<{ markdown: string }>('/bugrelay/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeId, question: question.trim(), analysis }),
      })
      setReport(data.markdown)
      setReportMsg('')
    } catch (e) {
      setReportMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report)
      setReportMsg('已复制 ✓')
      setTimeout(() => setReportMsg(''), 1500)
    } catch {
      setReportMsg('复制失败，请手动选择文本')
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      {/* 左栏：在线会话 */}
      <Card className="h-fit lg:sticky lg:top-24">
        <CardHeader>
          <CardTitle>会话</CardTitle>
          <span className="text-xs text-muted">{sessions.filter((s) => s.online).length} 在线</span>
        </CardHeader>
        {listError ? <p className="text-sm text-destructive">{listError}</p> : null}
        {!sessions.length && !listError ? (
          <p className="text-sm leading-relaxed text-muted">
            暂无会话。目标页面贴入 snippet 后自动上线（
            <code className="text-xs">tkt bugrelay snippet</code>）。
          </p>
        ) : null}
        <ul className="space-y-1.5">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              <button
                type="button"
                onClick={() => {
                  setActiveId(s.sessionId)
                  setAnalysis(null)
                  setReport('')
                }}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                  s.sessionId === activeId
                    ? 'border-primary/40 bg-primary/10'
                    : 'border-border/60 hover:bg-surface/70',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      s.online ? 'bg-[#67c23a]' : 'bg-muted/40',
                    )}
                  />
                  <span className="truncate text-sm font-medium">
                    {s.page.title || s.page.url || s.sessionId}
                  </span>
                  {s.unreadErrors > 0 ? (
                    <span className="ml-auto size-2 shrink-0 rounded-full bg-destructive" />
                  ) : null}
                </div>
                <div className="mt-1 truncate pl-4 text-xs text-muted">
                  {s.route || s.page.url || ''} · {fmtAgo(s.lastActive)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {/* 主区 */}
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>AI 归属分析</CardTitle>
            {active ? (
              <Badge className={active.online ? '' : 'bg-muted/20 text-muted'}>
                {active.online ? '在线' : '离线'}
              </Badge>
            ) : null}
          </CardHeader>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='描述问题，如「点保存没反应」「列表金额显示 NaN」'
            rows={3}
            className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none transition-colors focus:border-primary/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void runAnalyze()} disabled={busy || !active?.online || !question.trim()}>
              {busy ? '分析中…' : 'AI 分析'}
            </Button>
            <Button variant="secondary" onClick={() => void pullSnapshot()} disabled={!active?.online}>
              刷新数据
            </Button>
            {progress ? <span className="text-sm text-muted">{progress}</span> : null}
            {active && !active.online ? (
              <span className="text-sm text-destructive">页面已离线，无法分析</span>
            ) : null}
          </div>
          {analyzeError ? <p className="mt-3 text-sm text-destructive">{analyzeError}</p> : null}
        </Card>

        {analysis ? (
          <Card>
            <CardHeader>
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-2.5 py-1 text-sm font-semibold',
                  ATTRIBUTION_META[analysis.attribution].cls,
                )}
              >
                {ATTRIBUTION_META[analysis.attribution].label}
              </span>
              <span className="text-sm text-muted">置信 {analysis.confidence}</span>
            </CardHeader>
            <p className="text-[0.95rem] font-medium leading-relaxed">{analysis.summary}</p>
            <ResultList title="依据" items={analysis.evidence} mono />
            <ResultList title="建议" items={analysis.suggestions} />
            <ResultList title="涉及路由" items={analysis.routes} mono />
            <ResultList title="涉及文件" items={analysis.files} mono />
            <div className="mt-4 flex items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => void buildReport()}>
                生成 bug 报告
              </Button>
              {reportMsg ? <span className="text-xs text-muted">{reportMsg}</span> : null}
            </div>
            {report ? (
              <div className="mt-3">
                <div className="mb-2 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => void copyReport()}>
                    复制 markdown
                  </Button>
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-surface/60 p-3 text-xs leading-relaxed">
                  {report}
                </pre>
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>数据核对</CardTitle>
            {snapshotAt ? (
              <span className="text-xs text-muted">快照于 {new Date(snapshotAt).toLocaleTimeString()}</span>
            ) : null}
            {snapshotMsg ? <span className="text-xs text-muted">{snapshotMsg}</span> : null}
          </CardHeader>
          {snapshot ? (
            <DataPanels snapshot={snapshot} />
          ) : (
            <p className="text-sm text-muted">
              暂无数据。点「刷新数据」实时拉取，或运行一次 AI 分析后自动填充。
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

function ResultList({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  if (!items.length) return null
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {title}
      </h3>
      <ul className={cn('space-y-1 text-sm leading-relaxed', mono && 'font-mono text-[0.82rem]')}>
        {items.map((it, i) => (
          <li key={i} className="rounded-md bg-surface/50 px-2.5 py-1.5">
            {it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function fmtAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s 前`
  if (s < 3600) return `${Math.round(s / 60)}min 前`
  return `${Math.round(s / 3600)}h 前`
}
