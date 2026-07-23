/**
 * model-bench 核心：拉模型、流式测 TTFT/Total、写 history。
 * 数据：~/.config/tkt/bench/
 */
import * as fs from 'fs'
import * as path from 'path'
import { dataDir, ensureDataDir } from '../../core/paths'

export const BENCH_ARG = 'bench'

export type GatewayEnv = {
  baseUrl: string | null
  apiKey: string | null
  missing: string[]
  /** file = gateway.json；env = 进程环境；none = 都没有 */
  source: 'file' | 'env' | 'none'
  configPath: string
}

export type StreamSample = {
  model: string
  firstTokenMs: number | null
  firstTokenSec: number | null
  totalMs: number | null
  totalSec: number | null
  finishedAt: string
  sawDone: boolean
  ok: boolean
  error: string | null
  bytes: number
  prompt?: string
}

export type ModelResult = {
  model: string
  ok: boolean
  rounds: number
  okRounds: number
  ttftSec: number | null
  totalSec: number | null
  firstTokenMsAvg: number | null
  totalMsAvg: number | null
  samples: StreamSample[]
  error: string | null
}

export type BenchResult = {
  results: ModelResult[]
  ranked: ModelResult[]
  failed: ModelResult[]
  prompt: string | null
  rounds: number
  concurrency: number
  staggerMs: number
  at: string
  sortBy: 'ttftSec' | 'totalSec'
  metric: 'ttftSec' | 'totalSec'
}

export type ProgressEvent =
  | { type: 'round_prompt'; round: number; prompt: string }
  | { type: 'model_start'; model: string; round: number; rounds: number }
  | { type: 'round_done'; model: string; round: number; sample: StreamSample }
  | { type: 'model_done'; result: ModelResult }

export function configDir(): string {
  return dataDir(BENCH_ARG)
}

export function ensureConfigDir(): string {
  return ensureDataDir(BENCH_ARG)
}

export function gatewayConfigPath(): string {
  return path.join(configDir(), 'gateway.json')
}

type GatewayFile = { baseUrl?: string; apiKey?: string }

function readGatewayFile(): GatewayFile | null {
  try {
    const raw = fs.readFileSync(gatewayConfigPath(), 'utf8')
    return JSON.parse(raw) as GatewayFile
  } catch {
    return null
  }
}

/** 优先 ~/.config/tkt/bench/gateway.json，其次进程 env（CLI 临时覆盖） */
export function readEnv(): GatewayEnv {
  const configPath = gatewayConfigPath()
  const file = readGatewayFile()
  const fileBase = file?.baseUrl?.trim() || null
  const fileKey = file?.apiKey?.trim() || null
  if (fileBase && fileKey) {
    return { baseUrl: fileBase, apiKey: fileKey, missing: [], source: 'file', configPath }
  }

  const envBase = (process.env.AI_BASE_URL || '').trim() || null
  const envKey = (process.env.AI_API_KEY || '').trim() || null
  if (envBase && envKey) {
    return { baseUrl: envBase, apiKey: envKey, missing: [], source: 'env', configPath }
  }

  const baseUrl = fileBase || envBase
  const apiKey = fileKey || envKey
  const missing: string[] = []
  if (!baseUrl) missing.push('baseUrl')
  if (!apiKey) missing.push('apiKey')
  return {
    baseUrl,
    apiKey,
    missing,
    source: 'none',
    configPath,
  }
}

export function saveGatewayConfig(input: { baseUrl: string; apiKey?: string }): GatewayEnv {
  ensureConfigDir()
  const prev = readGatewayFile() || {}
  const baseUrl = input.baseUrl.trim()
  if (!baseUrl) throw new Error('baseUrl 不能为空')
  const apiKey =
    input.apiKey !== undefined && input.apiKey.trim()
      ? input.apiKey.trim()
      : (prev.apiKey || '').trim()
  if (!apiKey) throw new Error('apiKey 不能为空')
  normalizeApiRoot(baseUrl)
  fs.writeFileSync(
    gatewayConfigPath(),
    JSON.stringify({ baseUrl, apiKey }, null, 2) + '\n',
    'utf8',
  )
  return readEnv()
}

export function maskApiKey(key: string | null): string | null {
  if (!key) return null
  if (key.length <= 8) return '*'.repeat(key.length)
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

/** Normalize to API root ending with /v1 */
export function normalizeApiRoot(baseUrl: string): string {
  let u = String(baseUrl).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) {
    throw new Error('Invalid baseUrl: must start with http:// or https://')
  }
  if (!/\/v1$/i.test(u)) u = `${u}/v1`
  return u
}

function modelsUrl(apiRoot: string): string {
  return `${apiRoot}/models`
}

function chatUrl(apiRoot: string): string {
  return `${apiRoot}/chat/completions`
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

function parseModelIds(payload: unknown): string[] {
  const data = (payload as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const ids: string[] = []
  for (const item of data) {
    const row = item as { id?: string; model?: string }
    const id = row?.id || row?.model
    if (typeof id === 'string' && id.trim()) ids.push(id.trim())
  }
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b))
}

export async function fetchModels(
  apiRoot: string,
  apiKey: string,
  { timeoutMs = 30000 }: { timeoutMs?: number } = {},
): Promise<string[]> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(modelsUrl(apiRoot), {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`GET /models non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`)
    }
    if (!res.ok) {
      const j = json as { error?: { message?: string }; message?: string }
      const msg = j.error?.message || j.message || text.slice(0, 200)
      throw new Error(`GET /models HTTP ${res.status}: ${msg}`)
    }
    return parseModelIds(json)
  } finally {
    clearTimeout(t)
  }
}

/** ms → seconds, 2 decimal places */
export function msToSec(ms: number | null | undefined): number | null {
  if (ms == null || Number.isNaN(ms)) return null
  return Math.round(Number(ms) / 10) / 100
}

const PROBE_TOPICS = [
  '今天适合散步吗',
  '咖啡和茶哪个提神',
  '一句话解释什么是哈希',
  '推荐一个放松方式',
  '圆周率前五位是什么',
  '南北方冬天有何不同',
  '如何保持专注',
  '列举三种常见排序',
  '海水为什么是咸的',
  '用一个比喻说明缓存',
  '周一和周五心情差在哪',
  '什么是幂等',
]

export function buildProbePrompt(base: string | null | undefined): string {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const topic = PROBE_TOPICS[Math.floor(Math.random() * PROBE_TOPICS.length)]!
  const templates = [
    `请用不超过30字回答：${topic}？(probe:${nonce})`,
    `一句话回复即可：${topic}。[${nonce}]`,
    `简答（防缓存 ${nonce}）：${topic}`,
    `用中文短句说明：${topic} #${nonce}`,
  ]
  const picked = templates[Math.floor(Math.random() * templates.length)]!
  const custom = typeof base === 'string' ? base.trim() : ''
  if (custom && custom !== '你好' && !/^auto$/i.test(custom)) {
    return `${custom}\n\n(probe:${nonce} · ${topic})`
  }
  return picked
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createSemaphore(max: number) {
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (active < max) {
        active += 1
        resolve()
      } else {
        waiters.push(resolve)
      }
    })
  const release = () => {
    active -= 1
    const next = waiters.shift()
    if (next) {
      active += 1
      next()
    }
  }
  return { acquire, release }
}

async function mapStaggered<T, R>(
  items: T[],
  { concurrency = Infinity, staggerMs = 1000 }: { concurrency?: number; staggerMs?: number },
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return []
  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.min(concurrency as number, items.length))
    : items.length
  const sem = createSemaphore(limit)
  const t0 = Date.now()

  return Promise.all(
    items.map((item, i) =>
      (async () => {
        const target = t0 + i * Math.max(0, staggerMs)
        const wait = target - Date.now()
        if (wait > 0) await sleep(wait)
        await sem.acquire()
        try {
          return await fn(item, i)
        } finally {
          sem.release()
        }
      })(),
    ),
  )
}

export async function measureStream(
  apiRoot: string,
  apiKey: string,
  model: string,
  prompt: string,
  { timeoutMs = 120000 }: { timeoutMs?: number } = {},
): Promise<StreamSample> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const started = performance.now()
  let firstTokenMs: number | null = null
  let sawDone = false
  let error: string | null = null
  let bytes = 0

  try {
    const res = await fetch(chatUrl(apiRoot), {
      method: 'POST',
      headers: {
        ...authHeaders(apiKey),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: ctrl.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      let msg = text.slice(0, 300)
      try {
        const j = JSON.parse(text) as { error?: { message?: string }; message?: string }
        msg = j.error?.message || j.message || msg
      } catch {
        /* keep */
      }
      throw new Error(`HTTP ${res.status}: ${msg}`)
    }

    if (!res.body) throw new Error('No response body (stream unsupported in this Node runtime)')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) bytes += value.byteLength
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n/)
      buffer = parts.pop() || ''

      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          sawDone = true
          continue
        }
        let json: {
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
        }
        try {
          json = JSON.parse(data)
        } catch {
          continue
        }
        const delta = json.choices?.[0]?.delta
        const content = delta?.content
        if (typeof content === 'string' && content.length > 0 && firstTokenMs == null) {
          firstTokenMs = Math.round(performance.now() - started)
        }
        const finish = json.choices?.[0]?.finish_reason
        if (finish) sawDone = true
      }
    }

    if (firstTokenMs == null) {
      error = 'stream ended without content token'
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'AbortError') {
      error = `timeout (${timeoutMs}ms)`
    } else {
      error = e instanceof Error ? e.message : String(e)
    }
  } finally {
    clearTimeout(t)
  }

  const totalMs = Math.round(performance.now() - started)
  const ok = firstTokenMs != null && !error
  return {
    model,
    firstTokenMs,
    firstTokenSec: msToSec(firstTokenMs),
    totalMs: ok ? totalMs : null,
    totalSec: ok ? msToSec(totalMs) : null,
    finishedAt: new Date().toISOString(),
    sawDone,
    ok,
    error: ok ? null : error || 'unknown',
    bytes,
  }
}

export async function benchModels(
  apiRoot: string,
  apiKey: string,
  models: string[],
  {
    prompt = null,
    randomizePrompt = true,
    rounds = 1,
    timeoutMs = 120000,
    sortBy = 'total',
    concurrency = 6,
    staggerMs = 1000,
    onProgress,
  }: {
    prompt?: string | null
    randomizePrompt?: boolean
    rounds?: number
    timeoutMs?: number
    sortBy?: 'total' | 'ttft'
    concurrency?: number
    staggerMs?: number
    onProgress?: (ev: ProgressEvent) => void
  } = {},
): Promise<BenchResult> {
  const list = [...models]
  const resultsByModel = new Map<string, StreamSample[]>(list.map((m) => [m, []]))

  for (let r = 0; r < rounds; r++) {
    const promptForRound = randomizePrompt
      ? buildProbePrompt(prompt)
      : prompt && String(prompt).trim()
        ? String(prompt).trim()
        : buildProbePrompt(null)
    if (onProgress) onProgress({ type: 'round_prompt', round: r + 1, prompt: promptForRound })

    const roundEntries = await mapStaggered(list, { concurrency, staggerMs }, async (model) => {
      if (onProgress) onProgress({ type: 'model_start', model, round: r + 1, rounds })
      const sample = await measureStream(apiRoot, apiKey, model, promptForRound, { timeoutMs })
      sample.prompt = promptForRound
      if (onProgress) onProgress({ type: 'round_done', model, round: r + 1, sample })
      return { model, sample }
    })
    for (const { model, sample } of roundEntries) {
      resultsByModel.get(model)!.push(sample)
    }
  }

  const results = list.map((model) => {
    const samples = resultsByModel.get(model) || []
    const okSamples = samples.filter((s) => s.ok && typeof s.firstTokenMs === 'number')
    const firsts = okSamples.map((s) => s.firstTokenMs!)
    const totals = okSamples.map((s) => s.totalMs).filter((n): n is number => typeof n === 'number')
    const avgTtftMs = firsts.length
      ? Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length)
      : null
    const avgTotalMs = totals.length
      ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)
      : null
    const entry: ModelResult = {
      model,
      ok: firsts.length > 0,
      rounds: samples.length,
      okRounds: firsts.length,
      ttftSec: msToSec(avgTtftMs),
      totalSec: msToSec(avgTotalMs),
      firstTokenMsAvg: avgTtftMs,
      totalMsAvg: avgTotalMs,
      samples,
      error: firsts.length
        ? null
        : samples.map((s) => s.error).filter(Boolean)[0] || 'all rounds failed',
    }
    if (onProgress) onProgress({ type: 'model_done', result: entry })
    return entry
  })

  const keyMs = sortBy === 'ttft' ? 'firstTokenMsAvg' : 'totalMsAvg'
  const ranked = [...results]
    .filter((r) => r.ok && r[keyMs] != null)
    .sort((a, b) => (a[keyMs] as number) - (b[keyMs] as number))
  const failed = results.filter((r) => !r.ok)

  let lastPrompt: string | null = prompt || null
  for (const r of results) {
    const s = (r.samples || [])[r.samples.length - 1]
    if (s?.prompt) {
      lastPrompt = s.prompt
      break
    }
  }

  return {
    results,
    ranked,
    failed,
    prompt: lastPrompt,
    rounds,
    concurrency: Number.isFinite(concurrency) ? concurrency : list.length,
    staggerMs,
    at: new Date().toISOString(),
    sortBy: sortBy === 'ttft' ? 'ttftSec' : 'totalSec',
    metric: sortBy === 'ttft' ? 'ttftSec' : 'totalSec',
  }
}

export function formatRankTable(bench: BenchResult): string {
  const lines: string[] = []
  const sortLabel = bench.sortBy === 'totalSec' ? 'totalSec' : 'ttftSec'
  lines.push(`# Model bench · TTFT + total (seconds) @ ${bench.at}`)
  lines.push(
    `sort: ${sortLabel}  concurrency: ${bench.concurrency}  stagger: ${bench.staggerMs}ms  prompt: ${JSON.stringify(bench.prompt)}  rounds: ${bench.rounds}`,
  )
  lines.push('')
  lines.push('| Rank | Model | Total (s) | TTFT (s) | OK |')
  lines.push('| ---: | --- | ---: | ---: | ---: |')
  bench.ranked.forEach((r, i) => {
    const ttft = r.ttftSec != null ? r.ttftSec.toFixed(2) : '-'
    const total = r.totalSec != null ? r.totalSec.toFixed(2) : '-'
    lines.push(`| ${i + 1} | ${r.model} | ${total} | ${ttft} | ${r.okRounds}/${r.rounds} |`)
  })
  if (bench.failed.length) {
    lines.push('')
    lines.push('## Failed')
    for (const f of bench.failed) {
      lines.push(`- ${f.model}: ${f.error}`)
    }
  }
  if (bench.ranked.length) {
    const top = bench.ranked[0]!
    const why =
      sortLabel === 'ttftSec'
        ? `lowest TTFT ${top.ttftSec!.toFixed(2)}s`
        : `lowest total ${top.totalSec!.toFixed(2)}s`
    lines.push('')
    lines.push(`**Recommendation:** prefer \`${top.model}\` now (${why}).`)
  }
  return lines.join('\n')
}

export function saveHistory(bench: BenchResult): string {
  const dir = path.join(ensureConfigDir(), 'history')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `${stamp}.json`)
  const slim = {
    at: bench.at,
    sortBy: bench.sortBy,
    concurrency: bench.concurrency,
    staggerMs: bench.staggerMs,
    prompt: bench.prompt,
    rounds: bench.rounds,
    ranked: bench.ranked.map((r) => ({
      model: r.model,
      ttftSec: r.ttftSec,
      totalSec: r.totalSec,
      okRounds: r.okRounds,
      rounds: r.rounds,
    })),
    failed: bench.failed.map((f) => ({ model: f.model, error: f.error })),
  }
  fs.writeFileSync(file, JSON.stringify(slim, null, 2), 'utf8')
  return file
}

export class EnvMissingError extends Error {
  code = 'ENV_MISSING' as const
  missing: string[]
  constructor(missing: string[]) {
    super(`Missing gateway config: ${missing.join(', ')}（UI 保存或写 gateway.json）`)
    this.missing = missing
  }
}

export function requireGateway(): { apiRoot: string; apiKey: string; baseUrl: string } {
  const env = readEnv()
  if (env.missing.length) throw new EnvMissingError(env.missing)
  return {
    apiRoot: normalizeApiRoot(env.baseUrl!),
    apiKey: env.apiKey!,
    baseUrl: env.baseUrl!,
  }
}
