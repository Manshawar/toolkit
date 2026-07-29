/**
 * bugrelay Hono 路由：REST（/bugrelay/api/*）+ ws 通道（/bugrelay/ws）+ collector.js host。
 *
 * - CORS 仅挂 /bugrelay/*，OPTIONS 补 Access-Control-Allow-Private-Network（PNA：
 *   https 测试环境页面 → http://127.0.0.1 属 public→loopback，Chrome 94+ 预检缺此头被拦）
 * - ws 协议见方案附录 A：hello / event / result / command / ping-pong，命令白名单，禁 eval
 * - 页面路由 /bugrelay 由 SPA 托管（mountSpa 兜底），分析进度走 SSE 不与 ws 混用
 */
import * as fs from 'fs'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import type { UpgradeWebSocket, WSContext, WSEvents } from 'hono/ws'
import { assetPath } from '@/core/paths'
import { analysisSchema, runAnalysis, summarizeSnapshot } from './analyze'
import { buildBugReport } from './report'
import {
  clearSessions,
  clearUnread,
  findByWs,
  getSession,
  listSessions,
  markOffline,
  pushEvent,
  resolveResult,
  sendCommand,
  setSnapshot,
  touch,
  upsertHello,
  COMMAND_WHITELIST,
  type BugrelayCommand,
  type PageInfo,
} from './session'
import { readSettings, saveSettings, addSourceDir } from './settings'
import { isServiceUp, startService, stopService, servicePort } from './service'
import { buildSnippet, lanIp, DEFAULT_BUGRELAY_PORT } from './snippet'

function collectorJs(c: Context) {
  const file = assetPath('bugrelay', 'collector.js')
  if (!fs.existsSync(file)) return c.text('collector.js 缺失（检查包 assets）', 503)
  c.header('Cache-Control', 'no-store')
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  return c.body(fs.readFileSync(file))
}

function createBugrelayApiRoutes(): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    const list = listSessions()
    return c.json({
      ok: true,
      port: Number(process.env.BUGRELAY_PORT) || DEFAULT_BUGRELAY_PORT,
      sessions: list.length,
      online: list.filter((s) => s.online).length,
    })
  })

  app.get('/sessions', (c) => c.json({ sessions: listSessions() }))

  app.get('/snapshot', async (c) => {
    const sessionId = c.req.query('sessionId') ?? ''
    const s = getSession(sessionId)
    if (!s) return c.json({ error: `会话不存在: ${sessionId}` }, 404)
    // pull=1：在线时实时拉取并缓存；否则返回缓存
    if (c.req.query('pull') === '1') {
      try {
        const data = await sendCommand(sessionId, 'get_snapshot')
        setSnapshot(sessionId, data)
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 502)
      }
    }
    clearUnread(sessionId)
    const full = c.req.query('full') === '1'
    return c.json({
      sessionId,
      snapshotAt: s.snapshotAt,
      snapshot: full ? s.snapshot : summarizeSnapshot(s.snapshot),
    })
  })

  /** AI 分析：SSE 流（snapshot → analyzing → tool×N → done/error） */
  app.post('/analyze', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string
      question?: string
    }
    if (!body.sessionId || !body.question?.trim()) {
      return c.json({ error: 'sessionId 与 question 必填' }, 400)
    }
    const sessionId = body.sessionId
    const question = body.question.trim()
    return streamSSE(c, async (stream) => {
      const emit = (event: Record<string, unknown>) =>
        stream.writeSSE({ event: 'progress', data: JSON.stringify(event) })
      try {
        const analysis = await runAnalysis({
          sessionId,
          question,
          onProgress: (e) => {
            void emit(e)
          },
        })
        await stream.writeSSE({ event: 'done', data: JSON.stringify({ analysis }) })
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
        })
      }
    })
  })

  app.post('/report', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string
      question?: string
      analysis?: unknown
    }
    const parsed = analysisSchema.safeParse(body.analysis)
    if (!body.sessionId || typeof body.question !== 'string' || !parsed.success) {
      return c.json({ error: 'sessionId / question / analysis 必填且格式正确' }, 400)
    }
    return c.json({ markdown: buildBugReport({ sessionId: body.sessionId, question: body.question, analysis: parsed.data }) })
  })

  /** 调试：手动下发命令 */
  app.post('/command', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      sessionId?: string
      cmd?: string
      params?: Record<string, unknown>
    }
    if (!body.sessionId || !body.cmd) return c.json({ error: 'sessionId 与 cmd 必填' }, 400)
    if (!COMMAND_WHITELIST.includes(body.cmd as BugrelayCommand)) {
      return c.json({ error: `命令不在白名单，可用: ${COMMAND_WHITELIST.join(', ')}` }, 400)
    }
    try {
      const data = await sendCommand(body.sessionId, body.cmd as BugrelayCommand, body.params ?? {})
      return c.json({ ok: true, data })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  })

  app.post('/clear', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string }
    return c.json({ cleared: clearSessions(body.sessionId) })
  })

  app.get('/settings', (c) => c.json(readSettings()))

  app.post('/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      addDir?: string
      removeDir?: string
      redact?: boolean
      redactKeys?: string[]
    }
    try {
      if (typeof body.addDir === 'string' && body.addDir.trim()) {
        addSourceDir(body.addDir.trim())
      }
      if (typeof body.removeDir === 'string') {
        const abs = body.removeDir.trim()
        const cur = readSettings()
        saveSettings({ addDirs: cur.addDirs.filter((d) => d !== abs) })
      }
      if (typeof body.redact === 'boolean' || Array.isArray(body.redactKeys)) {
        saveSettings({
          ...(typeof body.redact === 'boolean' ? { redact: body.redact } : {}),
          ...(Array.isArray(body.redactKeys) ? { redactKeys: body.redactKeys } : {}),
        })
      }
      return c.json(readSettings())
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
    }
  })

  app.get('/snippet', (c) => {
    const port = Number(process.env.BUGRELAY_PORT) || DEFAULT_BUGRELAY_PORT
    return c.json({ snippet: buildSnippet(port), lanIp: lanIp(), port })
  })

  // 服务开关：供 tkt ui 页面控制 9527（挂在共享路由，ui 与 bugrelay 服务都暴露；9527 上 start 为 no-op）
  app.get('/service/status', async (c) => {
    const port = servicePort()
    return c.json({ port, up: await isServiceUp(port) })
  })

  app.post('/service', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { action?: string }
    const port = servicePort()
    try {
      if (body.action === 'start') {
        await startService(port)
      } else if (body.action === 'stop') {
        await stopService(port)
      } else {
        return c.json({ error: 'action 须为 start | stop' }, 400)
      }
      return c.json({ ok: true, port, up: await isServiceUp(port) })
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  })

  return app
}

/** REST + collector.js（SPA 页面 /bugrelay 由 mountSpa 托管） */
export function mountBugrelayRoutes(app: Hono): void {
  // CORS + PNA 仅 /bugrelay/*（dev 工具全开；ws 无同源策略不受限）
  // PNA 中间件须在 cors 前：cors 对 OPTIONS 预检直接终结，不过 next
  app.use('/bugrelay/*', async (c, next) => {
    await next()
    if (c.req.method === 'OPTIONS') {
      c.header('Access-Control-Allow-Private-Network', 'true')
    }
  })
  app.use(
    '/bugrelay/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  )
  app.route('/bugrelay/api', createBugrelayApiRoutes())
  app.get('/bugrelay/collector.js', collectorJs)
  // 根路径别名：snippet / 老 snippet 兼容
  app.get('/collector.js', collectorJs)
}

// ---------- ws 通道（附录 A 协议） ----------

const PING_INTERVAL_MS = 30_000
const pingTimers = new WeakMap<WSContext, NodeJS.Timeout>()

interface IncomingMessage {
  type?: string
  sessionId?: string
  page?: PageInfo
  route?: string
  caps?: string[]
  kind?: string
  data?: unknown
  cmdId?: string
  ok?: boolean
  error?: string
}

function handleWsMessage(ws: WSContext, raw: string): void {
  let msg: IncomingMessage
  try {
    msg = JSON.parse(raw) as IncomingMessage
  } catch {
    return
  }
  if (msg.type === 'hello' && typeof msg.sessionId === 'string') {
    upsertHello(msg.sessionId, msg.page ?? {}, msg.route, msg.caps ?? [], ws)
    return
  }
  const session = findByWs(ws)
  if (!session) return
  if (msg.type === 'event' && typeof msg.kind === 'string') {
    pushEvent(session.id, msg.kind, msg.data)
  } else if (msg.type === 'result' && typeof msg.cmdId === 'string') {
    resolveResult(session.id, msg.cmdId, msg.ok !== false, msg.ok === false ? (msg.error ?? msg.data) : msg.data)
  } else if (msg.type === 'pong') {
    touch(session.id)
  }
}

/** 挂 ws upgrade（由启动方传入 node-server v2 的 upgradeWebSocket） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerBugrelayWs(app: Hono, upgradeWebSocket: UpgradeWebSocket<any, any>): void {
  app.get(
    '/bugrelay/ws',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upgradeWebSocket((): WSEvents<any> => ({
      onOpen(_evt, ws) {
        const timer = setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: 'ping' }))
          } catch {
            /* 连接已死，onClose 清理 */
          }
        }, PING_INTERVAL_MS)
        timer.unref()
        pingTimers.set(ws, timer)
      },
      onMessage(evt, ws) {
        handleWsMessage(ws, typeof evt.data === 'string' ? evt.data : '')
      },
      onClose(_evt, ws) {
        const timer = pingTimers.get(ws)
        if (timer) clearInterval(timer)
        pingTimers.delete(ws)
        markOffline(ws)
      },
    })),
  )
}
