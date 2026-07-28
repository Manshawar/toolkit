import { useEffect, useState } from 'react'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Badge } from '@web/components/ui/badge'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { cn } from '@web/lib/utils'
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

type ProviderItem = {
  id: string
  displayName: string
  keyEnv: string
  hasKey: boolean
  apiKeyMasked?: string
}

type ProvidersInfo = {
  providers: ProviderItem[]
  default: string
}

type KeySaveResponse = {
  ok: boolean
  providers: ProviderItem[]
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

export function TokenPlanPage() {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null)
  const [providersInfo, setProvidersInfo] = useState<ProvidersInfo | null>(null)
  const [activeProvider, setActiveProvider] = useState('')
  const [planMsg, setPlanMsg] = useState('')
  const [planBusy, setPlanBusy] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [keyMsg, setKeyMsg] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  async function loadPlan(providerId?: string, infoOverride?: ProvidersInfo) {
    setPlanBusy(true)
    try {
      let info = infoOverride ?? providersInfo
      if (!info) {
        info = await fetchJson<ProvidersInfo>('/api/usage/providers')
        setProvidersInfo(info)
      }
      const pid = providerId || activeProvider || info.default
      setActiveProvider(pid)
      const prov = info.providers.find((p) => p.id === pid)
      if (!prov?.hasKey) {
        setSnap(null)
        setPlanMsg(`未配置 ${prov?.keyEnv ?? 'API Key'}，在下方填写后自动刷新`)
        return
      }
      const data = await fetchJson<UsageSnapshot>(`/api/usage?provider=${pid}`)
      setSnap(data)
      setPlanMsg('')
    } catch (e) {
      setSnap(null)
      setPlanMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPlanBusy(false)
    }
  }

  async function makeDefault() {
    if (!activeProvider) return
    setPlanBusy(true)
    try {
      await fetchJson('/api/usage/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: activeProvider }),
      })
      const info = await fetchJson<ProvidersInfo>('/api/usage/providers')
      setProvidersInfo(info)
    } catch (e) {
      setPlanMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setPlanBusy(false)
    }
  }

  async function saveKey() {
    const key = apiKey.trim()
    if (!activeProvider || !key) return
    setKeyBusy(true)
    setKeyMsg('')
    try {
      const res = await fetchJson<KeySaveResponse>('/api/usage/key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: activeProvider, apiKey: key }),
      })
      const next: ProvidersInfo = {
        providers: res.providers,
        default: providersInfo?.default ?? activeProvider,
      }
      setProvidersInfo(next)
      setApiKey('')
      setKeyMsg('已保存')
      await loadPlan(undefined, next)
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setKeyBusy(false)
    }
  }

  const activeInfo = providersInfo?.providers.find((p) => p.id === activeProvider)

  useEffect(() => {
    void loadPlan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page-stack">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Token Plan</h1>
        <p className="text-sm text-muted">云端套餐配额：切换 provider，或把当前项设为默认。</p>
      </header>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">
              {providersInfo?.providers.find((p) => p.id === activeProvider)?.displayName ||
                '配额'}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {snap ? `拉取于 ${new Date(snap.fetchedAt).toLocaleString('zh-CN')}` : '云端套餐配额'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {providersInfo ? (
              <nav className="flex gap-0.5 rounded-xl border border-border/80 bg-card/80 p-1">
                {[...providersInfo.providers]
                  .sort((a, b) =>
                    a.id === providersInfo.default ? -1 : b.id === providersInfo.default ? 1 : 0,
                  )
                  .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setKeyMsg('')
                      setApiKey('')
                      void loadPlan(p.id)
                    }}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      activeProvider === p.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted hover:bg-surface hover:text-foreground',
                    )}
                  >
                    {p.id}
                    {providersInfo.default === p.id ? ' ·默认' : ''}
                  </button>
                ))}
              </nav>
            ) : null}
            {providersInfo &&
            activeProvider &&
            activeProvider !== providersInfo.default ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={planBusy}
                onClick={() => void makeDefault()}
              >
                设为默认
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={planBusy}
              onClick={() => void loadPlan()}
            >
              {planBusy ? '刷新中…' : '刷新配额'}
            </Button>
          </div>
        </div>

        {planMsg ? (
          <p className={`text-sm ${snap ? 'text-muted' : 'text-destructive'}`}>{planMsg}</p>
        ) : null}

        {activeInfo ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label>API Key（{activeInfo.keyEnv}）</Label>
              <Input
                type="password"
                value={apiKey}
                placeholder={
                  activeInfo.apiKeyMasked
                    ? `已保存 ${activeInfo.apiKeyMasked} · 留空不改`
                    : activeProvider === 'kimi'
                      ? 'sk-kimi-…（kimi.com/code 控制台创建）'
                      : '粘贴密钥'
                }
                onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={keyBusy || !apiKey.trim()}
              onClick={() => void saveKey()}
            >
              {keyBusy ? '保存中…' : '保存 Key'}
            </Button>
            {keyMsg ? (
              <p className={`text-sm ${keyMsg === '已保存' ? 'text-success' : 'text-destructive'}`}>
                {keyMsg}
              </p>
            ) : null}
          </div>
        ) : null}

        {snap ? (
          <div className="space-y-4">
            {snap.models.map((m) => (
              <Card key={m.name}>
                <CardHeader>
                  <CardTitle>{m.name}</CardTitle>
                  {m.meta
                    ? Object.entries(m.meta).map(([k, v]) => <Badge key={k}>{v}</Badge>)
                    : null}
                </CardHeader>
                <ul className="space-y-4">
                  {m.windows.map((w) => (
                    <li key={w.label}>
                      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{w.label}</span>
                        <span className="tabular-nums text-muted">
                          {Math.round(w.remainingPercent)}% 剩余
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-surface">
                        <div
                          className={`h-full rounded-full transition-all ${barTone(w.remainingPercent)}`}
                          style={{
                            width: `${Math.max(0, Math.min(100, w.remainingPercent))}%`,
                          }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted">
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
          <p className="text-sm text-muted">加载中…</p>
        ) : null}
      </section>
    </div>
  )
}
