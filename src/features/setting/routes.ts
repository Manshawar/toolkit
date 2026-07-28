/**
 * Setting API：全局 AI 配置 + CLI 更新检查偏好
 */
import { Hono } from 'hono'
import { getAiConfigView, saveAiBackend, saveAiConfigFields, aiEnvPath } from '@/agent'
import { loadUpdatePrefs, saveUpdatePrefs } from '@/core/update-check'

/** API：挂在 /api/setting */
export function createSettingApiRoutes(): Hono {
  const app = new Hono()

  app.get('/ai', (c) => c.json(getAiConfigView()))

  app.post('/ai', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        baseUrl?: string
        apiKey?: string
        model?: string
        backend?: string
      }
      // backend 与网关字段解耦：只切 backend 时不要求网关三项齐全
      if (body.backend !== undefined) {
        const b = String(body.backend).trim().toLowerCase()
        if (b !== 'claude' && b !== 'openai' && b !== 'auto') {
          return c.json({ error: `backend 只支持 claude | openai | auto，收到: ${body.backend}` }, 400)
        }
        saveAiBackend(b)
      }
      const hasGatewayFields =
        body.baseUrl !== undefined || body.apiKey !== undefined || body.model !== undefined
      if (hasGatewayFields) {
        saveAiConfigFields({
          baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
        })
      }
      if (body.backend === undefined && !hasGatewayFields) {
        return c.json({ error: '空请求：需 backend 或 baseUrl/apiKey/model 至少一项' }, 400)
      }
      return c.json({
        ok: true,
        saved: aiEnvPath(),
        ...getAiConfigView(),
      })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  app.get('/update', (c) => c.json(loadUpdatePrefs()))

  app.post('/update', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        checkIntervalHours?: number
      }
      const prefs = saveUpdatePrefs({
        checkIntervalHours:
          typeof body.checkIntervalHours === 'number' ? body.checkIntervalHours : undefined,
      })
      return c.json({ ok: true, ...prefs })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  return app
}

export function mountSettingRoutes(app: Hono): void {
  app.route('/api/setting', createSettingApiRoutes())
}
