/**
 * bugrelay 会话存储：ws 连接 + ring buffer 服务端缓存。
 *
 * - 会话按 sessionId 存内存 Map，上限 50；闲置 2h 清理
 * - 在线判定：ws 连接存在（断线保留会话供回看快照）
 * - 命令通道：sendCommand 下发 {type:"command"}，等 {type:"result"}，30s 超时
 * - 异常即时推（event/jserror）入 ring buffer，供分析页红点与报告引用
 */
import type { WSContext } from 'hono/ws'

export interface PageInfo {
  url?: string
  title?: string
  ua?: string
  lanxinVer?: string
  net?: string
}

export interface SessionEvent {
  kind: string
  data: unknown
  ts: number
}

export interface Session {
  id: string
  page: PageInfo
  route?: string
  caps: string[]
  ws: WSContext | null
  connectedAt: number
  lastActive: number
  /** 离线以来的未读异常数（分析页红点） */
  unreadErrors: number
  events: SessionEvent[]
  /** 最近一次 get_snapshot 全量缓存（报告引用） */
  snapshot: unknown | null
  snapshotAt: number
  pending: Map<string, { resolve: (d: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>
}

/** 命令白名单（附录 A.3）——禁 eval 类，防 server→page 任意执行 */
export const COMMAND_WHITELIST = [
  'get_snapshot',
  'get_vue_state',
  'get_vuex_trace',
  'get_breadcrumbs',
  'get_dom',
  'get_perf',
  'get_storage',
] as const
export type BugrelayCommand = (typeof COMMAND_WHITELIST)[number]

const MAX_SESSIONS = 50
const MAX_EVENTS = 50
const IDLE_MS = 2 * 60 * 60 * 1000
const CMD_TIMEOUT_MS = 30_000

const sessions = new Map<string, Session>()
let cmdSeq = 0

export function upsertHello(
  sessionId: string,
  page: PageInfo,
  route: string | undefined,
  caps: string[],
  ws: WSContext,
): Session {
  let s = sessions.get(sessionId)
  if (!s) {
    s = {
      id: sessionId,
      page,
      route,
      caps,
      ws,
      connectedAt: Date.now(),
      lastActive: Date.now(),
      unreadErrors: 0,
      events: [],
      snapshot: null,
      snapshotAt: 0,
      pending: new Map(),
    }
    sessions.set(sessionId, s)
    evictOverflow()
  }
  s.page = page
  if (route !== undefined) s.route = route
  s.caps = caps
  s.ws = ws
  s.lastActive = Date.now()
  return s
}

export function markOffline(ws: WSContext): void {
  for (const s of sessions.values()) {
    if (s.ws === ws) {
      s.ws = null
      s.lastActive = Date.now()
      for (const p of s.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('页面连接已断开'))
      }
      s.pending.clear()
    }
  }
}

export function findByWs(ws: WSContext): Session | undefined {
  for (const s of sessions.values()) if (s.ws === ws) return s
  return undefined
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function touch(id: string): void {
  const s = sessions.get(id)
  if (s) s.lastActive = Date.now()
}

export function pushEvent(sessionId: string, kind: string, data: unknown): void {
  const s = sessions.get(sessionId)
  if (!s) return
  s.events.push({ kind, data, ts: Date.now() })
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS)
  if (kind === 'jserror' || kind === 'unhandledrejection') s.unreadErrors += 1
  s.lastActive = Date.now()
}

export function clearUnread(id: string): void {
  const s = sessions.get(id)
  if (s) s.unreadErrors = 0
}

export function resolveResult(sessionId: string, cmdId: string, ok: boolean, data: unknown): void {
  const s = sessions.get(sessionId)
  const p = s?.pending.get(cmdId)
  if (!s || !p) return
  clearTimeout(p.timer)
  s.pending.delete(cmdId)
  s.lastActive = Date.now()
  if (ok) {
    p.resolve(data)
  } else {
    p.reject(new Error(typeof data === 'string' ? data : JSON.stringify(data)))
  }
}

/** 下发命令并等待回传；页面离线立即失败 */
export function sendCommand(
  sessionId: string,
  cmd: BugrelayCommand,
  params: Record<string, unknown> = {},
  timeoutMs = CMD_TIMEOUT_MS,
): Promise<unknown> {
  if (!COMMAND_WHITELIST.includes(cmd)) {
    return Promise.reject(new Error(`命令不在白名单: ${cmd}`))
  }
  const s = sessions.get(sessionId)
  if (!s) return Promise.reject(new Error(`会话不存在: ${sessionId}`))
  if (!s.ws) return Promise.reject(new Error('页面不在线（ws 已断开）'))
  const cmdId = `c${++cmdSeq}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.pending.delete(cmdId)
      reject(new Error(`命令 ${cmd} 超时（${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)
    s.pending.set(cmdId, { resolve, reject, timer })
    s.ws!.send(JSON.stringify({ type: 'command', cmdId, cmd, params }))
  })
}

export function setSnapshot(sessionId: string, snapshot: unknown): void {
  const s = sessions.get(sessionId)
  if (!s) return
  s.snapshot = snapshot
  s.snapshotAt = Date.now()
}

export function listSessions() {
  return [...sessions.values()]
    .map((s) => ({
      sessionId: s.id,
      online: s.ws !== null,
      page: s.page,
      route: s.route,
      caps: s.caps,
      connectedAt: s.connectedAt,
      lastActive: s.lastActive,
      unreadErrors: s.unreadErrors,
      eventCount: s.events.length,
      hasSnapshot: s.snapshot !== null,
    }))
    .sort((a, b) => b.lastActive - a.lastActive)
}

export function clearSessions(id?: string): number {
  if (id) {
    const s = sessions.get(id)
    if (s?.ws) {
      try {
        s.ws.close()
      } catch {
        /* ignore */
      }
    }
    return sessions.delete(id) ? 1 : 0
  }
  const n = sessions.size
  for (const s of sessions.values()) {
    if (s.ws) {
      try {
        s.ws.close()
      } catch {
        /* ignore */
      }
    }
  }
  sessions.clear()
  return n
}

function evictOverflow(): void {
  if (sessions.size <= MAX_SESSIONS) return
  const offline = [...sessions.values()]
    .filter((s) => s.ws === null)
    .sort((a, b) => a.lastActive - b.lastActive)
  for (const s of offline) {
    if (sessions.size <= MAX_SESSIONS) break
    sessions.delete(s.id)
  }
}

/** 闲置清理：离线超 2h 的会话 */
export function startIdleSweep(): void {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const s of [...sessions.values()]) {
      if (s.ws === null && now - s.lastActive > IDLE_MS) sessions.delete(s.id)
    }
  }, 10 * 60 * 1000)
  timer.unref()
}
