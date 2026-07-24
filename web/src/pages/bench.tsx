import { useEffect, useMemo, useState } from 'preact/hooks'
import { Badge } from '@web/components/ui/badge'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import {
  fetchJson,
  readSse,
  type Health,
  type RankRow,
  type WatchStatus,
} from '@web/lib/api'
import { LatencyChart } from '@web/pages/bench-chart'

const LINE_COLORS = [
  '#1a5f7a', '#e07a3d', '#2a9d8f', '#c44536', '#457b9d',
  '#e9c46a', '#264653', '#f4a261', '#6d597a', '#355070',
]

export function BenchPage(_props: { path?: string }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [healthMsg, setHealthMsg] = useState('')
  const [healthOk, setHealthOk] = useState(false)

  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [modelMeta, setModelMeta] = useState('')

  const [rounds, setRounds] = useState(1)
  const [concurrency, setConcurrency] = useState(6)
  const [staggerMs, setStaggerMs] = useState(1000)
  const [sortBy, setSortBy] = useState<'total' | 'ttft'>('total')
  const [prompt, setPrompt] = useState('')

  const [busy, setBusy] = useState(false)
  const [runStatus, setRunStatus] = useState('')
  const [runOk, setRunOk] = useState(false)
  const [ranked, setRanked] = useState<RankRow[]>([])
  const [failed, setFailed] = useState<Array<{ model: string; error: string }>>([])
  const [rec, setRec] = useState('')

  const [watch, setWatch] = useState<WatchStatus | null>(null)
  const [watchMsg, setWatchMsg] = useState('')
  const [watchOk, setWatchOk] = useState(false)
  const [watchOn, setWatchOn] = useState(false)
  const [watchMin, setWatchMin] = useState(10)
  const [syncWatch, setSyncWatch] = useState(false)

  const ready = Boolean(health?.ok)
  const selectedList = useMemo(
    () => models.filter((m) => selected[m]),
    [models, selected],
  )

  function setControlsDisabled(on: boolean) {
    return !on || busy
  }

  async function loadHealth() {
    try {
      const h = await fetchJson<Health>('/api/bench/health')
      setHealth(h)
      if (h.baseUrl) setBaseUrl(h.baseUrl)
      setApiKey('')
      if (h.ok) {
        setHealthOk(true)
        setHealthMsg(`API root: ${h.apiRoot || ''} · source=${h.source || ''}`)
        await loadModels()
      } else {
        setHealthOk(false)
        setHealthMsg(
          h.missing?.length
            ? `缺少: ${h.missing.join(', ')}`
            : h.error || '填写上方 URL / Key 后点保存',
        )
      }
    } catch (e) {
      setHealthOk(false)
      setHealthMsg(e instanceof Error ? e.message : String(e))
    }
    await refreshWatch()
  }

  async function saveConfig() {
    setHealthMsg('保存中…')
    setHealthOk(false)
    try {
      const data = await fetchJson<Health & { saved?: string }>('/api/bench/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey }),
      })
      setHealthOk(true)
      setHealthMsg(`已保存 → ${data.saved || data.configPath || ''}`)
      await loadHealth()
    } catch (e) {
      setHealthOk(false)
      setHealthMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function loadModels() {
    setModelMeta('加载中…')
    try {
      const data = await fetchJson<{ models: string[] }>('/api/bench/models')
      const list = data.models || []
      setModels(list)
      setSelected(Object.fromEntries(list.map((id) => [id, true])))
      setModelMeta(`${list.length} models`)
      await refreshWatch()
    } catch (e) {
      setModelMeta('')
      setRunOk(false)
      setRunStatus(`加载模型失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function applyWatchStatus(st: WatchStatus) {
    setSyncWatch(true)
    setWatch(st)
    setWatchOn(!!st.enabled)
    if (st.intervalMin) setWatchMin(st.intervalMin)
    setSyncWatch(false)
    let msg = st.enabled
      ? `服务端定时 ON · 每 ${st.intervalMin} 分钟 · 历史 ${st.probeCount} 次`
      : `服务端定时 OFF · 历史 ${st.probeCount || 0} 次`
    if (st.running) msg += ' · 正在探测…'
    if (st.lastRunAt) msg += ` · 最近 ${st.lastRunAt}`
    if (st.lastError) msg += `\n错误: ${st.lastError}`
    setWatchMsg(msg)
    setWatchOk(!st.lastError && !!st.enabled)
  }

  async function refreshWatch() {
    try {
      const st = await fetchJson<WatchStatus>('/api/bench/watch')
      applyWatchStatus(st)
    } catch (e) {
      setWatchOk(false)
      setWatchMsg(e instanceof Error ? e.message : String(e))
    }
  }

  function watchPayload(runNow = true) {
    return {
      intervalMin: watchMin || 10,
      models: selectedList,
      prompt,
      rounds: rounds || 1,
      concurrency: concurrency || 6,
      staggerMs: staggerMs || 1000,
      sortBy: 'total' as const,
      runNow,
    }
  }

  async function runBench() {
    if (!ready || busy) return
    if (!selectedList.length) {
      setRunOk(false)
      setRunStatus('请至少选择一个模型')
      return
    }
    setBusy(true)
    setRunOk(false)
    setRunStatus('测速中…')
    setRec('')
    setFailed([])
    try {
      const res = await fetch('/api/bench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: selectedList,
          rounds: rounds || 1,
          prompt,
          randomizePrompt: true,
          sortBy,
          concurrency: concurrency || 6,
          staggerMs: staggerMs || 1000,
        }),
      })
      if (!res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      type DonePayload = {
        ranked?: RankRow[]
        failed?: Array<{ model: string; error: string }>
        at?: string
        sortBy?: string
      }
      const box: { done: DonePayload | null } = { done: null }
      await readSse(res, (event, data) => {
        const d = data as Record<string, unknown>
        if (event === 'progress' && d.type === 'round_prompt') {
          setRunStatus(`本轮 prompt: ${d.prompt}`)
        }
        if (event === 'progress' && d.type === 'model_start') {
          setRunStatus(`测速中 → ${d.model}`)
        }
        if (event === 'progress' && d.type === 'model_done') {
          const r = d.result as RankRow & { ok?: boolean }
          setRunStatus(
            r.ok
              ? `${r.model} TTFT=${Number(r.ttftSec).toFixed(2)}s total=${Number(r.totalSec).toFixed(2)}s`
              : `${r.model} FAIL`,
          )
        }
        if (event === 'done') box.done = data as DonePayload
        if (event === 'error') throw new Error(String(d.error || 'bench error'))
      })
      if (!box.done) throw new Error('未收到完成事件')
      const done = box.done
      const rankedRows = done.ranked || []
      setRanked(rankedRows)
      setFailed(done.failed || [])
      if (rankedRows[0]) {
        const top = rankedRows[0]
        const tip =
          done.sortBy === 'ttft' || sortBy === 'ttft'
            ? `TTFT ${Number(top.ttftSec).toFixed(2)}s`
            : `Total ${Number(top.totalSec).toFixed(2)}s`
        setRec(`现在优先用 ${top.model}（${tip}）`)
      }
      setRunOk(true)
      setRunStatus(`完成 @ ${done.at || ''}`)
    } catch (e) {
      setRunOk(false)
      setRunStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadHealth()
    const t = setInterval(() => void refreshWatch(), 15000)
    return () => clearInterval(t)
  }, [])

  const disabled = setControlsDisabled(ready)
  const selectClass =
    'h-10 rounded-md border border-border bg-white/90 px-3 text-sm transition-colors focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30'

  return (
    <div class="animate-rise space-y-6">
      <header class="space-y-2">
        <h1 class="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          网关测速
        </h1>
        <p class="max-w-xl text-sm leading-relaxed text-muted">
          对比模型总耗时与首包延迟。定时探测跑在服务端，关页面也会继续。
        </p>
      </header>

      <Card>
        <CardHeader>
          <div class="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              class={`size-2 shrink-0 rounded-full ${healthOk ? 'bg-success' : 'bg-border'}`}
              aria-hidden
            />
            <CardTitle>{healthOk ? '网关已就绪' : '网关配置'}</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadHealth()}>
            刷新
          </Button>
        </CardHeader>
        <div class="flex flex-wrap gap-3">
          <div class="min-w-[240px] flex-1 space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              placeholder="https://ai-gateway.example.com"
              onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="min-w-[200px] flex-1 space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              placeholder={
                health?.apiKeyMasked
                  ? `已保存 ${health.apiKeyMasked} · 留空不改`
                  : '粘贴 API Key'
              }
              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="flex items-end">
            <Button onClick={() => void saveConfig()}>保存</Button>
          </div>
        </div>
        <p class="mt-3 text-xs text-muted">
          保存在本机 {health?.configPath || '~/.config/tkt/bench/gateway.json'}
        </p>
        {healthMsg ? (
          <p
            class={`mt-2 whitespace-pre-wrap text-sm ${healthOk ? 'text-success' : 'text-destructive'}`}
          >
            {healthMsg}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>测速参数</CardTitle>
          <div class="ml-auto flex flex-wrap gap-2">
            <Button variant="secondary" disabled={disabled} onClick={() => void loadModels()}>
              加载模型
            </Button>
            <Button disabled={disabled} onClick={() => void runBench()}>
              一键测速
            </Button>
          </div>
        </CardHeader>

        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div class="space-y-1.5">
            <Label>轮次</Label>
            <Input
              type="number"
              min={1}
              max={5}
              value={rounds}
              onInput={(e) => setRounds(Number((e.target as HTMLInputElement).value) || 1)}
            />
          </div>
          <div class="space-y-1.5">
            <Label>并发</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={concurrency}
              onInput={(e) =>
                setConcurrency(Number((e.target as HTMLInputElement).value) || 6)
              }
            />
          </div>
          <div class="space-y-1.5">
            <Label>错峰 (ms)</Label>
            <Input
              type="number"
              min={0}
              step={500}
              value={staggerMs}
              onInput={(e) =>
                setStaggerMs(Number((e.target as HTMLInputElement).value) || 0)
              }
            />
          </div>
          <div class="space-y-1.5">
            <Label>排序</Label>
            <select
              class={selectClass}
              value={sortBy}
              onChange={(e) =>
                setSortBy((e.target as HTMLSelectElement).value as 'total' | 'ttft')
              }
            >
              <option value="total">总耗时（推荐）</option>
              <option value="ttft">首包延迟</option>
            </select>
          </div>
        </div>

        <div class="mt-3 space-y-1.5">
          <Label>提示词前缀</Label>
          <Input
            value={prompt}
            placeholder="留空则使用随机短问"
            onInput={(e) => setPrompt((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-4">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => setSelected(Object.fromEntries(models.map((m) => [m, true])))}
          >
            全选
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => setSelected(Object.fromEntries(models.map((m) => [m, false])))}
          >
            全不选
          </Button>
          <span class="text-sm text-muted">{modelMeta}</span>
        </div>

        <div class="mt-3 grid max-h-[280px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1.5 overflow-auto rounded-xl bg-surface/50 p-2">
          {models.map((id) => (
            <label
              key={id}
              class="flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-card"
            >
              <Checkbox
                checked={!!selected[id]}
                onChange={(e) => {
                  const on = (e.target as HTMLInputElement).checked
                  setSelected((s) => ({ ...s, [id]: on }))
                  void refreshWatch()
                }}
              />
              <span class="break-all leading-snug">{id}</span>
            </label>
          ))}
        </div>

        {runStatus ? (
          <p
            class={`mt-3 whitespace-pre-wrap text-sm ${
              runOk
                ? 'text-success'
                : runStatus.includes('失败') || runStatus.includes('请')
                  ? 'text-destructive'
                  : 'text-muted'
            }`}
          >
            {runStatus}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>单次排行</CardTitle>
          {rec ? <span class="text-sm text-muted">{rec}</span> : null}
        </CardHeader>
        <div class="overflow-x-auto rounded-xl border border-border/70">
          <table class="w-full text-sm">
            <thead>
              <tr class="bg-surface/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted">
                <th class="px-3 py-2.5 text-right font-semibold">#</th>
                <th class="px-3 py-2.5 font-semibold">模型</th>
                <th class="px-3 py-2.5 text-right font-semibold">总耗时</th>
                <th class="px-3 py-2.5 text-right font-semibold">首包</th>
                <th class="px-3 py-2.5 text-right font-semibold">成功</th>
              </tr>
            </thead>
            <tbody>
              {!ranked.length ? (
                <tr>
                  <td colSpan={5} class="px-3 py-8 text-center text-muted">
                    尚未测速
                  </td>
                </tr>
              ) : (
                ranked.map((r, i) => (
                  <tr
                    key={r.model}
                    class={`border-t border-border/70 ${i === 0 ? 'bg-accent/35 font-semibold' : ''}`}
                  >
                    <td class="px-3 py-2.5 text-right tabular-nums text-muted">{i + 1}</td>
                    <td class="px-3 py-2.5">
                      {r.model}
                      {i === 0 ? <Badge>推荐</Badge> : null}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {r.totalSec != null ? `${Number(r.totalSec).toFixed(2)}s` : '—'}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {r.ttftSec != null ? `${Number(r.ttftSec).toFixed(2)}s` : '—'}
                    </td>
                    <td class="px-3 py-2.5 text-right tabular-nums">
                      {r.okRounds}/{r.rounds}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {failed.length ? (
          <div class="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {failed.map((f) => (
              <p key={f.model}>
                {f.model}: {f.error}
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader className="items-start">
          <div class="min-w-0 flex-1 space-y-1">
            <CardTitle>定时探测</CardTitle>
            <p class="text-xs text-muted">服务端定时跑；折线为总耗时走势，排行按均值。</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-2 rounded-md border border-border/80 bg-surface/40 px-3 py-1.5 text-sm">
              <Checkbox
                checked={watchOn}
                disabled={!ready}
                onChange={async (e) => {
                  if (syncWatch) return
                  const on = (e.target as HTMLInputElement).checked
                  try {
                    if (on) {
                      const st = await fetchJson<WatchStatus>('/api/bench/watch/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(watchPayload(true)),
                      })
                      applyWatchStatus(st)
                    } else {
                      applyWatchStatus(
                        await fetchJson('/api/bench/watch/stop', { method: 'POST' }),
                      )
                    }
                  } catch (err) {
                    setWatchOk(false)
                    setWatchMsg(err instanceof Error ? err.message : String(err))
                    await refreshWatch()
                  }
                }}
              />
              开启
            </label>
            <div class="flex items-center gap-2">
              <Label class="normal-case tracking-normal">间隔</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={watchMin}
                class="w-16"
                onInput={(e) =>
                  setWatchMin(Number((e.target as HTMLInputElement).value) || 10)
                }
                onChange={async () => {
                  if (syncWatch || !watchOn) return
                  await fetch('/api/bench/watch/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...watchPayload(false), runNow: false }),
                  })
                  await refreshWatch()
                }}
              />
              <span class="text-xs text-muted">分</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={async () => {
                if (!ready || busy) return
                setBusy(true)
                setWatchMsg('服务端立刻探测中…')
                try {
                  const res = await fetch('/api/bench/watch/probe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(watchPayload(true)),
                  })
                  const data = (await res.json()) as {
                    status?: WatchStatus
                    skipped?: boolean
                    ok?: boolean
                    error?: string
                  }
                  if (data.status) applyWatchStatus(data.status)
                  else await refreshWatch()
                  if (data.skipped) {
                    setWatchMsg('已有探测在跑，请稍候')
                    setWatchOk(false)
                  } else if (data.ok === false) {
                    throw new Error(data.error || 'probe failed')
                  }
                } catch (err) {
                  setWatchOk(false)
                  setWatchMsg(err instanceof Error ? err.message : String(err))
                } finally {
                  setBusy(false)
                  await refreshWatch()
                }
              }}
            >
              立刻探测
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!confirm('清空服务端定时探测历史？')) return
                await fetch('/api/bench/watch/clear', { method: 'POST' })
                await refreshWatch()
              }}
            >
              清空
            </Button>
          </div>
        </CardHeader>

        {watchMsg ? (
          <p
            class={`mb-3 whitespace-pre-wrap text-sm ${
              watchMsg.includes('错误')
                ? 'text-destructive'
                : watchOk
                  ? 'text-success'
                  : 'text-muted'
            }`}
          >
            {watchMsg}
          </p>
        ) : null}

        <LatencyChart
          probes={watch?.probes || []}
          selected={selectedList}
          colors={LINE_COLORS}
        />

        <div class="mt-5">
          <CardTitle class="mb-3">均值排行</CardTitle>
          <div class="overflow-x-auto rounded-xl border border-border/70">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-surface/60 text-left text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th class="px-3 py-2.5 text-right font-semibold">#</th>
                  <th class="px-3 py-2.5 font-semibold">模型</th>
                  <th class="px-3 py-2.5 text-right font-semibold">均值</th>
                  <th class="px-3 py-2.5 text-right font-semibold">标准差</th>
                  <th class="px-3 py-2.5 text-right font-semibold">样本</th>
                </tr>
              </thead>
              <tbody>
                {!(watch?.stability?.length) ? (
                  <tr>
                    <td colSpan={5} class="px-3 py-8 text-center text-muted">
                      尚无历史，开启定时或点「立刻探测」
                    </td>
                  </tr>
                ) : (
                  watch!.stability!.map((r, i) => (
                    <tr
                      key={r.model}
                      class={`border-t border-border/70 ${i === 0 ? 'bg-accent/35 font-semibold' : ''}`}
                    >
                      <td class="px-3 py-2.5 text-right tabular-nums text-muted">
                        {i + 1}
                      </td>
                      <td class="px-3 py-2.5">
                        {r.model}
                        {i === 0 ? <Badge>最稳</Badge> : null}
                      </td>
                      <td class="px-3 py-2.5 text-right tabular-nums">
                        {Number(r.avg).toFixed(2)}s
                      </td>
                      <td class="px-3 py-2.5 text-right tabular-nums">
                        {Number(r.sd).toFixed(2)}s
                      </td>
                      <td class="px-3 py-2.5 text-right tabular-nums">{r.n}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  )
}
