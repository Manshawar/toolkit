import { requireEnv, getEnv } from '@/core/env'
import { loadUsagePrefs, maskSecret, reloadUsageEnv } from './prefs'
import type { QuotaWindow, UsageModel, UsageProvider, UsageSnapshot } from './types'

interface MiniMaxModelRemain {
  model_name: string
  remains_time: number
  end_time: number
  current_interval_remaining_percent: number
  current_interval_usage_count: number
  current_interval_total_count: number
  weekly_remains_time: number
  weekly_end_time: number
  current_weekly_remaining_percent: number
  current_weekly_usage_count: number
  current_weekly_total_count: number
  weekly_boost_permille?: number
}

interface MiniMaxRemainsResponse {
  model_remains?: MiniMaxModelRemain[]
  base_resp?: { status_code: number; status_msg: string }
}

function windowOf(
  label: string,
  remainingPercent: number,
  remainsMs: number,
  endTime: number,
  used: number,
  total: number,
): QuotaWindow {
  return {
    label,
    remainingPercent: Math.max(0, Math.min(100, remainingPercent)),
    remainsMs,
    resetAt: new Date(endTime),
    used,
    total,
  }
}

function mapModel(item: MiniMaxModelRemain): UsageModel {
  const windows: QuotaWindow[] = [
    windowOf(
      '5 小时窗口',
      item.current_interval_remaining_percent,
      item.remains_time,
      item.end_time,
      item.current_interval_usage_count,
      item.current_interval_total_count,
    ),
    windowOf(
      '本周',
      item.current_weekly_remaining_percent,
      item.weekly_remains_time,
      item.weekly_end_time,
      item.current_weekly_usage_count,
      item.current_weekly_total_count,
    ),
  ]
  const meta: Record<string, string> = {}
  if (item.weekly_boost_permille != null) {
    meta.boost = `${(item.weekly_boost_permille / 1000).toFixed(1)}x`
  }
  return {
    name: item.model_name,
    windows,
    meta: Object.keys(meta).length ? meta : undefined,
  }
}

function createMinimax(): UsageProvider {
  reloadUsageEnv()
  const apiKey = requireEnv('MINIMAX_API_KEY')
  const base = getEnv('MINIMAX_API_BASE', 'https://www.minimaxi.com').replace(/\/$/, '')

  return {
    id: 'minimax',
    displayName: 'MiniMax Token Plan',
    async fetchUsage(): Promise<UsageSnapshot> {
      const res = await fetch(`${base}/v1/token_plan/remains`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}: ${res.statusText}`)

      const data = (await res.json()) as MiniMaxRemainsResponse
      const code = data.base_resp?.status_code
      if (code != null && code !== 0) {
        throw new Error(`MiniMax API: ${data.base_resp?.status_msg || code}`)
      }

      const models = (data.model_remains || []).map(mapModel)
      if (!models.length) throw new Error('MiniMax 返回空用量数据')

      return {
        provider: 'minimax',
        displayName: 'MiniMax Token Plan',
        fetchedAt: new Date(),
        models,
      }
    },
  }
}

/* ---------------- Kimi Code（GET https://api.kimi.com/coding/v1/usages） ---------------- */

/** 配额字段值可能是数字或字符串 */
interface KimiQuota {
  used?: string | number
  limit?: string | number
  remaining?: string | number
  /** ISO 字符串或 epoch（秒 / 毫秒） */
  resetTime?: string | number
}

interface KimiLimitItem {
  window?: { duration?: number; timeUnit?: string }
  detail?: KimiQuota
}

interface KimiUsagesResponse {
  /** 周配额（7 天滚动窗口） */
  usage?: KimiQuota
  /** 滚动窗口限频；300 分钟（5 小时）条目为会话配额 */
  limits?: KimiLimitItem[]
  user?: { membership?: { level?: string } }
  parallel?: { limit?: number }
}

function num(v: string | number | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function windowMinutes(w?: { duration?: number; timeUnit?: string }): number | null {
  const duration = num(w?.duration)
  if (duration == null) return null
  switch (w?.timeUnit) {
    case 'TIME_UNIT_SECOND':
      return duration / 60
    case 'TIME_UNIT_MINUTE':
      return duration
    case 'TIME_UNIT_HOUR':
      return duration * 60
    case 'TIME_UNIT_DAY':
      return duration * 1440
    default:
      return null
  }
}

function parseResetTime(raw: string | number | undefined): Date | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    const ms = Date.parse(raw)
    return Number.isNaN(ms) ? undefined : new Date(ms)
  }
  const n = num(raw)
  if (n == null) return undefined
  return new Date(n > 1e12 ? n : n * 1000)
}

function kimiWindow(label: string, q: KimiQuota | undefined): QuotaWindow | null {
  if (!q) return null
  const limit = num(q.limit)
  if (limit == null || limit <= 0) return null
  const used = num(q.used)
  const remaining = num(q.remaining)
  const remainingPercent =
    used != null
      ? (1 - used / limit) * 100
      : remaining != null
        ? (remaining / limit) * 100
        : null
  if (remainingPercent == null) return null
  const resetAt = parseResetTime(q.resetTime)
  return {
    label,
    remainingPercent: Math.max(0, Math.min(100, remainingPercent)),
    remainsMs: resetAt ? Math.max(0, resetAt.getTime() - Date.now()) : undefined,
    resetAt,
    used: used ?? undefined,
    total: limit,
  }
}

/** limits[] 里挑 5 小时（300 分钟）会话窗口；无标注则取第一个带 detail 的 */
function pickSessionDetail(limits: KimiLimitItem[]): KimiQuota | undefined {
  let first: KimiQuota | undefined
  for (const item of limits) {
    if (!item.detail) continue
    if (!first) first = item.detail
    const minutes = windowMinutes(item.window)
    if (minutes != null && Math.abs(minutes - 300) < 1) return item.detail
  }
  return first
}

/** "LEVEL_INTERMEDIATE" → "Intermediate" */
function planLabel(level: string | undefined): string | undefined {
  if (!level) return undefined
  return level
    .replace(/^LEVEL_/, '')
    .toLowerCase()
    .replace(/(^|_)(\w)/g, (_m, sep: string, c: string) => (sep === '_' ? ' ' : '') + c.toUpperCase())
}

function createKimi(): UsageProvider {
  reloadUsageEnv()
  const apiKey = requireEnv('KIMI_API_KEY')
  const base = getEnv('KIMI_API_BASE', 'https://api.kimi.com').replace(/\/$/, '')

  return {
    id: 'kimi',
    displayName: 'Kimi Code Token Plan',
    async fetchUsage(): Promise<UsageSnapshot> {
      const res = await fetch(`${base}/coding/v1/usages`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })
      if (!res.ok) throw new Error(`Kimi HTTP ${res.status}: ${res.statusText}`)

      const data = (await res.json()) as KimiUsagesResponse
      const windows = [
        kimiWindow('5 小时窗口', pickSessionDetail(data.limits ?? [])),
        kimiWindow('本周', data.usage),
      ].filter((w): w is QuotaWindow => w != null)
      if (!windows.length) throw new Error('Kimi 返回空用量数据')

      const meta: Record<string, string> = {}
      const plan = planLabel(data.user?.membership?.level)
      if (plan) meta.plan = plan
      const parallel = num(data.parallel?.limit)
      if (parallel != null) meta.parallel = String(parallel)

      return {
        provider: 'kimi',
        displayName: 'Kimi Code Token Plan',
        fetchedAt: new Date(),
        models: [
          {
            name: 'Kimi Code',
            windows,
            meta: Object.keys(meta).length ? meta : undefined,
          },
        ],
      }
    },
  }
}

const factories: Record<string, () => UsageProvider> = {
  minimax: createMinimax,
  kimi: createKimi,
}

/** provider 目录：id / 展示名 / 所需环境变量（UI 列表 + health 用） */
export interface ProviderInfo {
  id: string
  displayName: string
  keyEnv: string
  hasKey: boolean
  apiKeyMasked?: string
}

export const PROVIDER_CATALOG: Array<Omit<ProviderInfo, 'hasKey' | 'apiKeyMasked'>> = [
  { id: 'minimax', displayName: 'MiniMax Token Plan', keyEnv: 'MINIMAX_API_KEY' },
  { id: 'kimi', displayName: 'Kimi Code Token Plan', keyEnv: 'KIMI_API_KEY' },
]

export function listProviders(): ProviderInfo[] {
  reloadUsageEnv()
  return PROVIDER_CATALOG.map((p) => {
    const key = getEnv(p.keyEnv)
    return { ...p, hasKey: Boolean(key), apiKeyMasked: key ? maskSecret(key) : undefined }
  })
}

/** 默认 provider：TKT_PROVIDER 环境变量（含用户级 usage/.env）> 持久化 prefs > minimax */
export function defaultProviderId(): string {
  reloadUsageEnv()
  const env = getEnv('TKT_PROVIDER')
  if (env) return env.toLowerCase()
  const pref = loadUsagePrefs().defaultProvider
  if (pref && factories[pref.toLowerCase()]) return pref.toLowerCase()
  return 'minimax'
}

export function resolveProvider(id?: string): UsageProvider {
  const providerId = (id || defaultProviderId()).toLowerCase()
  const factory = factories[providerId]
  if (!factory) {
    throw new Error(
      `未知 provider: ${providerId}。可用: ${Object.keys(factories).join(', ')}（.env 设 TKT_PROVIDER）`,
    )
  }
  return factory()
}
