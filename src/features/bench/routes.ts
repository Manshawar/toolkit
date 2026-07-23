/**
 * Hono 路由：页面 /bench + API /api/bench/*
 */
import * as fs from 'fs'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { assetPath } from '../../core/paths'
import {
  EnvMissingError,
  benchModels,
  fetchModels,
  gatewayConfigPath,
  maskApiKey,
  normalizeApiRoot,
  readEnv,
  requireGateway,
  saveGatewayConfig,
  saveHistory,
} from './lib'
import * as watch from './watch'

function readUiHtml(): string {
  return fs.readFileSync(assetPath('bench', 'ui.html'), 'utf8')
}

/** 页面路由：GET /bench */
export function createBenchPageRoutes(): Hono {
  const app = new Hono()
  app.get('/', (c) => c.html(readUiHtml()))
  app.get('/index.html', (c) => c.html(readUiHtml()))
  return app
}

function healthPayload() {
  const env = readEnv()
  let apiRoot: string | null = null
  let error: string | undefined
  try {
    if (env.baseUrl) apiRoot = normalizeApiRoot(env.baseUrl)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return {
    ok: env.missing.length === 0 && !error,
    missing: env.missing,
    source: env.source,
    configPath: env.configPath,
    baseUrl: env.baseUrl,
    apiKeyMasked: maskApiKey(env.apiKey),
    hasBase: Boolean(env.baseUrl),
    hasKey: Boolean(env.apiKey),
    apiRoot,
    error,
  }
}

/** API：挂在 /api/bench */
export function createBenchApiRoutes(): Hono {
  const app = new Hono()

  app.get('/health', (c) => c.json(healthPayload()))

  app.get('/config', (c) => c.json(healthPayload()))

  app.post('/config', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        baseUrl?: string
        apiKey?: string
      }
      if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) {
        return c.json({ error: 'baseUrl 必填' }, 400)
      }
      const env = saveGatewayConfig({
        baseUrl: body.baseUrl,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      })
      return c.json({
        ok: true,
        ...healthPayload(),
        saved: env.configPath || gatewayConfigPath(),
      })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  app.get('/models', async (c) => {
    try {
      const gw = requireGateway()
      const models = await fetchModels(gw.apiRoot, gw.apiKey)
      return c.json({ models, count: models.length })
    } catch (e) {
      return handleApiError(c, e)
    }
  })

  app.post('/', async (c) => {
    try {
      const gw = requireGateway()
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
      let models = Array.isArray(body.models)
        ? body.models.filter((m): m is string => typeof m === 'string')
        : null
      if (!models || !models.length) {
        models = await fetchModels(gw.apiRoot, gw.apiKey)
      }
      const rounds = Math.max(1, Math.min(5, parseInt(String(body.rounds ?? 1), 10) || 1))
      const prompt = typeof body.prompt === 'string' ? body.prompt : null
      const timeoutMs = Math.max(5000, parseInt(String(body.timeoutMs ?? 120000), 10) || 120000)
      const sortBy = body.sortBy === 'ttft' ? 'ttft' : 'total'
      const randomizePrompt = body.randomizePrompt !== false
      const staggerMs = Math.max(0, parseInt(String(body.staggerMs ?? 1000), 10) || 1000)
      let concurrency = 6
      if (body.concurrency === 'all' || body.concurrency === 0) {
        concurrency = Infinity
      } else if (body.concurrency != null && body.concurrency !== '') {
        const n = parseInt(String(body.concurrency), 10)
        if (Number.isFinite(n) && n > 0) concurrency = n
      }

      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: 'start',
          data: JSON.stringify({
            count: models!.length,
            rounds,
            sortBy,
            concurrency,
            staggerMs,
            randomizePrompt,
          }),
        })
        try {
          const bench = await benchModels(gw.apiRoot, gw.apiKey, models!, {
            prompt,
            randomizePrompt,
            rounds,
            timeoutMs,
            sortBy,
            concurrency,
            staggerMs,
            onProgress: (ev) => {
              void stream.writeSSE({ event: 'progress', data: JSON.stringify(ev) })
            },
          })
          let historyFile: string | null = null
          try {
            historyFile = saveHistory(bench)
          } catch {
            /* ignore */
          }
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              ranked: bench.ranked,
              failed: bench.failed,
              at: bench.at,
              prompt: bench.prompt,
              rounds: bench.rounds,
              sortBy: bench.sortBy,
              concurrency: bench.concurrency,
              staggerMs: bench.staggerMs,
              historyFile,
            }),
          })
        } catch (e) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
          })
        }
      })
    } catch (e) {
      return handleApiError(c, e)
    }
  })

  app.get('/watch', (c) => c.json(watch.getStatus()))

  app.post('/watch/start', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as watch.WatchConfigOpts
    return c.json(watch.startWatch(body))
  })

  app.post('/watch/stop', (c) => c.json(watch.stopWatch()))

  app.post('/watch/probe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as watch.WatchConfigOpts
    if (body && Object.keys(body).length) {
      watch.applyConfig(body)
    }
    const result = await watch.runProbe('manual')
    const statusCode = 'skipped' in result && result.skipped ? 409 : result.ok === false ? 500 : 200
    return c.json(result, statusCode as 200 | 409 | 500)
  })

  app.post('/watch/clear', (c) => c.json(watch.clearHistory()))

  return app
}

function handleApiError(c: { json: (obj: unknown, status?: number) => Response }, e: unknown) {
  if (e instanceof EnvMissingError) {
    return c.json(
      {
        error: e.message,
        missing: e.missing,
        configPath: gatewayConfigPath(),
      },
      503,
    )
  }
  return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
}

export function mountBenchRoutes(app: Hono): void {
  app.route('/bench', createBenchPageRoutes())
  app.route('/api/bench', createBenchApiRoutes())
}
