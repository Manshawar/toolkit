/**
 * Usage API：Token 用量快照
 * 挂载 /api/usage
 */
import { Hono } from 'hono'
import { getEnv, getProviderId } from '@/core/env'
import { resolveProvider } from './provider'
import type { UsageSnapshot } from './types'

function serializeSnapshot(s: UsageSnapshot) {
  return {
    provider: s.provider,
    displayName: s.displayName,
    fetchedAt: s.fetchedAt.toISOString(),
    models: s.models.map((m) => ({
      name: m.name,
      meta: m.meta,
      windows: m.windows.map((w) => ({
        label: w.label,
        remainingPercent: w.remainingPercent,
        remainsMs: w.remainsMs,
        resetAt: w.resetAt ? w.resetAt.toISOString() : undefined,
        used: w.used,
        total: w.total,
      })),
    })),
  }
}

export function createUsageApiRoutes(): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    const provider = (c.req.query('provider') || getProviderId()).toLowerCase()
    const hasKey = provider === 'minimax' ? Boolean(getEnv('MINIMAX_API_KEY', '')) : false
    return c.json({
      ok: hasKey,
      provider,
      providers: ['minimax'],
      hasKey,
      hint: hasKey ? undefined : '请在 .env 配置 MINIMAX_API_KEY（可选 MINIMAX_API_BASE）',
    })
  })

  app.get('/', async (c) => {
    try {
      const providerId = c.req.query('provider') || undefined
      const provider = resolveProvider(providerId)
      const snapshot = await provider.fetchUsage()
      return c.json(serializeSnapshot(snapshot))
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error('[api/usage]', error)
      return c.json({ error }, 500)
    }
  })

  return app
}

export function mountUsageRoutes(app: Hono): void {
  app.route('/api/usage', createUsageApiRoutes())
}
