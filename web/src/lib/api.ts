export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export type Health = {
  ok: boolean
  missing?: string[]
  source?: string
  configPath?: string
  baseUrl?: string
  apiKeyMasked?: string
  apiRoot?: string | null
  error?: string
}

export type RankRow = {
  model: string
  ttftSec: number | null
  totalSec: number | null
  okRounds: number
  rounds: number
}

export type WatchStatus = {
  enabled: boolean
  intervalMin?: number
  probeCount?: number
  running?: boolean
  lastRunAt?: string
  lastError?: string
  probes?: Array<{ at: string; points: Array<{ model: string; totalSec: number }> }>
  stability?: Array<{ model: string; avg: number; sd: number; n: number }>
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `网络失败: ${e.message}（确认 API :8787 在跑，或重启 pnpm ui:dev）`
        : '网络失败',
    )
  }
  const text = await res.text()
  let data: T & { error?: string } = {} as T & { error?: string }
  try {
    data = text ? (JSON.parse(text) as T & { error?: string }) : data
  } catch {
    if (!res.ok) {
      throw new Error(
        res.status === 500 || res.status === 502
          ? `API 不可用 HTTP ${res.status}（Vite 代理失败时常见：后端未启动，请重启 pnpm ui:dev）`
          : `HTTP ${res.status}`,
      )
    }
    throw new Error('响应不是 JSON')
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/** 简易 SSE 解析（bench POST） */
export async function readSse(
  res: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  if (!res.body) throw new Error('无响应流')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const lines = chunk.split('\n')
      let event = 'message'
      let dataLine = ''
      for (const line of lines) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) dataLine += line.slice(5).trim()
      }
      if (!dataLine) continue
      try {
        onEvent(event, JSON.parse(dataLine))
      } catch {
        /* skip */
      }
    }
  }
}
