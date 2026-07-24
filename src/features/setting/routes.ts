/**
 * Setting API：全局 AI 配置（供 gc / report / agent）
 */
import { Hono } from 'hono'
import { getAiConfigView, saveAiConfigFields, aiEnvPath } from '@/agent'

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
      }
      saveAiConfigFields({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
      })
      return c.json({
        ok: true,
        saved: aiEnvPath(),
        ...getAiConfigView(),
      })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  return app
}

export function mountSettingRoutes(app: Hono): void {
  app.route('/api/setting', createSettingApiRoutes())
}
