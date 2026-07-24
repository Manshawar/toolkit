/**
 * 本地 UI 单端口服务（Hono）。
 * API：各 feature mount；页面：assets/ui SPA。
 * `tkt <cmd> ui` 通过 path 打开对应路由。
 *
 * 默认端口偏门（38471），占用时自动顺延找空闲口。
 */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import type { Command } from 'commander'
import { mountBenchRoutes } from '@/features/bench/routes'
import { mountSettingRoutes } from '@/features/setting/routes'
import { mountReportRoutes } from '@/features/report/routes'
import { mountUsageRoutes } from '@/features/usage/routes'
import { gatewayConfigPath, normalizeApiRoot, readEnv } from '@/features/bench/lib'
import * as watch from '@/features/bench/watch'
import { mountSpa } from './spa'
import type { FeatureMount } from './types'

/** 偏门默认口，降低与常见 8787/3000 冲突 */
const DEFAULT_PORT = 38471

const mounts: FeatureMount[] = [
  mountBenchRoutes,
  mountSettingRoutes,
  mountReportRoutes,
  mountUsageRoutes,
]

export function createApp(): Hono {
  const app = new Hono()
  for (const mount of mounts) mount(app)
  mountSpa(app)
  return app
}

function normalizePath(raw?: string): string {
  if (!raw || raw === '/') return '/'
  const p = raw.startsWith('/') ? raw : `/${raw}`
  return p.replace(/\/+$/, '') || '/'
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* ignore */
  }
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

/** 从 preferred 起最多试 span 个端口 */
async function pickPort(preferred: number, span = 30): Promise<number> {
  for (let i = 0; i < span; i++) {
    const port = preferred + i
    if (port > 65535) break
    if (await canListen(port)) return port
  }
  throw new Error(`端口 ${preferred}–${Math.min(65535, preferred + span - 1)} 均被占用`)
}

export function startUiServer({
  port: preferredPort = DEFAULT_PORT,
  path: openPath = '/',
  open = true,
}: {
  port?: number
  /** SPA 路由，如 /report、/bench、/setting、/usage */
  path?: string
  /** 是否自动打开浏览器，默认 true */
  open?: boolean
} = {}): void {
  watch.bootstrap()
  const env = readEnv()
  const app = createApp()
  const route = normalizePath(openPath)

  void (async () => {
    let port: number
    try {
      port = await pickPort(preferredPort)
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
      return
    }
    if (port !== preferredPort) {
      console.log(`端口 ${preferredPort} 占用，改用 ${port}`)
    }

    serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
      const base = `http://127.0.0.1:${info.port}`
      const url = route === '/' ? `${base}/` : `${base}${route}`
      console.log(`tkt ui → ${url}`)
      if (open) openBrowser(url)
      if (env.missing.length) {
        console.log(`WARN: 未配置测速网关 — /bench 填写 URL/Key，将写入 ${gatewayConfigPath()}`)
      } else {
        try {
          console.log(`API root: ${normalizeApiRoot(env.baseUrl!)} · source=${env.source}`)
        } catch (e) {
          console.log(`WARN: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const st = watch.getStatus()
      if (st.enabled) {
        console.log(
          `[watch] ON · every ${st.intervalMin}min · probes=${st.probeCount} · ${st.stateFile}`,
        )
      } else {
        console.log('[watch] OFF · enable from UI (runs in this Node process)')
      }
      console.log('Ctrl+C to stop.')
    })
  })()
}

/** 注册 `tkt <cmd> ui`：启动同端口 SPA，打开指定路由 */
export function registerUiSubcommand(
  parent: Command,
  routePath: string,
  description = `打开本地 UI（${routePath}）`,
): void {
  parent
    .command('ui')
    .description(description)
    .option('--port <n>', '端口', String(DEFAULT_PORT))
    .option('--no-open', '不自动打开浏览器')
    .action((opts: { port?: string; open?: boolean }) => {
      startUiServer({
        port: parseInt(String(opts.port), 10) || DEFAULT_PORT,
        path: routePath,
        open: opts.open !== false,
      })
    })
}

export { DEFAULT_PORT }
