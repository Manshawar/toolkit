import { requireEnv, getEnv, getProviderId } from '../env'
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

const factories: Record<string, () => UsageProvider> = {
  minimax: createMinimax,
}

export function resolveProvider(id?: string): UsageProvider {
  const providerId = (id || getProviderId()).toLowerCase()
  const factory = factories[providerId]
  if (!factory) {
    throw new Error(
      `未知 provider: ${providerId}。可用: ${Object.keys(factories).join(', ')}（.env 设 TKT_PROVIDER）`,
    )
  }
  return factory()
}
