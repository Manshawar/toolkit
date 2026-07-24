import { useEffect, useRef, useState } from 'preact/hooks'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Badge } from '@web/components/ui/badge'
import { Input } from '@web/components/ui/input'
import { fetchJson } from '@web/lib/api'

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

const STORAGE_KEY = 'tkt.usage.refreshSec'
const MIN_SEC = 5
const DEFAULT_SEC = 30

function readIntervalSec(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY))
    if (Number.isFinite(n) && n >= MIN_SEC) return Math.floor(n)
  } catch {
    /* ignore */
  }
  return DEFAULT_SEC
}

function clampIntervalSec(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_SEC
  return Math.max(MIN_SEC, Math.floor(raw))
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
  const [snap, setSnap] = useState<UsageSnapshot | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(true)
  const [intervalSec, setIntervalSec] = useState(readIntervalSec)
  const [intervalDraft, setIntervalDraft] = useState(String(readIntervalSec()))
  const [nextAt, setNextAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const busyRef = useRef(false)
  const autoRef = useRef(auto)
  const intervalRef = useRef(intervalSec)
  autoRef.current = auto
  intervalRef.current = intervalSec

  async function load(opts?: { scheduleNext?: boolean }) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const h = await fetchJson<Health>('/api/usage/health')
      setHealth(h)
      if (!h.ok) {
        setSnap(null)
        setMsg(h.hint || '未配置 API Key')
        return
      }
      const data = await fetchJson<UsageSnapshot>('/api/usage')
      setSnap(data)
      setMsg('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
      if (opts?.scheduleNext !== false && autoRef.current) {
        setNextAt(Date.now() + intervalRef.current * 1000)
      }
    }
  }

  function applyInterval(raw: string | number) {
    const next = clampIntervalSec(Number(raw))
    setIntervalSec(next)
    setIntervalDraft(String(next))
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      /* ignore */
    }
    if (autoRef.current) setNextAt(Date.now() + next * 1000)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!auto) {
      setNextAt(null)
      return
    }
    if (nextAt == null) setNextAt(Date.now() + intervalSec * 1000)
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [auto, intervalSec])

  useEffect(() => {
    if (!auto || nextAt == null || busyRef.current) return
    if (now >= nextAt) void load()
  }, [now, nextAt, auto])

  const remainSec =
    auto && nextAt != null ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : null

  return (
    <div class="mx-auto max-w-2xl space-y-6">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display text-2xl font-bold tracking-tight">Token 用量</h1>
          <p class="mt-1 text-sm text-muted">
            {health?.provider || 'minimax'}
            {auto ? ` · 每 ${intervalSec}s 刷新` : ' · 手动刷新'}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant={auto ? 'default' : 'secondary'}
            size="sm"
            onClick={() => {
              setAuto((v) => {
                const on = !v
                if (on) setNextAt(Date.now() + intervalRef.current * 1000)
                return on
              })
            }}
          >
            {auto ? '自动 ON' : '自动 OFF'}
          </Button>
          <label class="flex items-center gap-1.5 text-sm text-muted">
            <span class="whitespace-nowrap">间隔</span>
            <Input
              type="number"
              min={MIN_SEC}
              step={1}
              value={intervalDraft}
              className="h-8 w-[4.5rem] px-2 text-center tabular-nums"
              onInput={(e) => setIntervalDraft((e.target as HTMLInputElement).value)}
              onChange={(e) => applyInterval((e.target as HTMLInputElement).value)}
              onBlur={(e) => applyInterval((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyInterval((e.target as HTMLInputElement).value)
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
            <span>秒</span>
          </label>
          <span
            class={`min-w-[5.5rem] rounded-md px-2 py-1 text-center text-sm tabular-nums ${
              auto ? 'bg-accent/70 text-primary' : 'bg-surface text-muted'
            }`}
          >
            {auto && remainSec != null ? `${remainSec}s` : '—'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? '刷新中…' : '立即刷新'}
          </Button>
        </div>
      </header>

      {msg ? (
        <p class={`text-sm ${snap ? 'text-muted' : 'text-destructive'}`}>{msg}</p>
      ) : null}

      {snap ? (
        <>
          <p class="text-xs text-muted">
            {snap.displayName} · 拉取于{' '}
            {new Date(snap.fetchedAt).toLocaleString('zh-CN')}
            {auto && remainSec != null ? ` · 下次刷新 ${remainSec}s` : ''}
          </p>
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
        </>
      ) : !msg ? (
        <p class="text-sm text-muted">加载中…</p>
      ) : null}
    </div>
  )
}
