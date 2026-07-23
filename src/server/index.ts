/**
 * 本地 UI 单端口服务（Hono）。
 * 各 feature 通过 mount 注册：/<arg> 页面 + /api/<arg>/*
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { mountBenchRoutes } from '../features/bench/routes'
import { ENV_BASE, normalizeApiRoot, readEnv } from '../features/bench/lib'
import * as watch from '../features/bench/watch'
import type { FeatureMount } from './types'

const DEFAULT_PORT = 8787

const mounts: FeatureMount[] = [mountBenchRoutes]

export function createApp(): Hono {
  const app = new Hono()
  app.get('/', (c) =>
    c.json({
      ok: true,
      tools: [{ name: 'bench', page: '/bench', api: '/api/bench' }],
    }),
  )
  for (const mount of mounts) mount(app)
  return app
}

export function startUiServer({ port = DEFAULT_PORT }: { port?: number } = {}): void {
  watch.bootstrap()
  const env = readEnv()
  const app = createApp()

  serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
    const url = `http://127.0.0.1:${info.port}/bench`
    console.log(`tkt ui → ${url}`)
    if (env.missing.length) {
      console.log(
        `WARN: missing ${env.missing.join(', ')} — run \`tkt config\`, then restart ui.`,
      )
    } else {
      try {
        console.log(`API root: ${normalizeApiRoot(env.baseUrl!)}`)
      } catch (e) {
        console.log(`WARN: ${e instanceof Error ? e.message : String(e)}`)
      }
      console.log(`env: ${ENV_BASE} / AI_API_KEY`)
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
}

export { DEFAULT_PORT }
