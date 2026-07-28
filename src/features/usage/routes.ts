/**
 * Usage API：Agent 本地用量 + Token Plan 快照
 * 挂载 /api/usage
 */
import { Hono } from 'hono'
import { aggregateAgentUsage, parsePeriod } from './agent'
import { defaultProviderId, listProviders, PROVIDER_CATALOG, resolveProvider } from './provider'
import { saveDefaultProvider, saveUsageEnvKey, usageEnvPath } from './prefs'
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
    const provider = (c.req.query('provider') || defaultProviderId()).toLowerCase()
    const info = listProviders().find((p) => p.id === provider)
    const hasKey = info?.hasKey ?? false
    return c.json({
      ok: hasKey,
      provider,
      providers: PROVIDER_CATALOG.map((p) => p.id),
      hasKey,
      hint: hasKey
        ? undefined
        : `未配置 ${info?.keyEnv ?? 'API Key'}（可在套餐页直接填写，或写入 .env）`,
    })
  })

  /** provider 列表 + 默认项（UI 切换器用） */
  app.get('/providers', (c) =>
    c.json({
      providers: listProviders(),
      default: defaultProviderId(),
    }),
  )

  /** 设默认 provider（持久化 ~/.config/tkt/usage/prefs.json） */
  app.post('/default', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { provider?: string }
      const id = String(body.provider ?? '').trim().toLowerCase()
      if (!PROVIDER_CATALOG.some((p) => p.id === id)) {
        return c.json(
          { error: `未知 provider: ${body.provider}。可用: ${PROVIDER_CATALOG.map((p) => p.id).join(', ')}` },
          400,
        )
      }
      saveDefaultProvider(id)
      return c.json({ ok: true, default: id })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  /** 填 provider API Key（持久化 ~/.config/tkt/usage/.env） */
  app.post('/key', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        provider?: string
        apiKey?: string
      }
      const id = String(body.provider ?? '').trim().toLowerCase()
      const info = PROVIDER_CATALOG.find((p) => p.id === id)
      if (!info) {
        return c.json(
          { error: `未知 provider: ${body.provider}。可用: ${PROVIDER_CATALOG.map((p) => p.id).join(', ')}` },
          400,
        )
      }
      const apiKey = String(body.apiKey ?? '').trim()
      if (!apiKey) return c.json({ error: 'apiKey 不能为空' }, 400)
      saveUsageEnvKey(info.keyEnv, apiKey)
      return c.json({ ok: true, saved: usageEnvPath(), providers: listProviders() })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  /** 本地 Agent 用量：?period=day|week|month|year */
  app.get('/agent', (c) => {
    const period = parsePeriod(c.req.query('period') || undefined)
    return c.json(aggregateAgentUsage(period))
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
