/**
 * 单一 SPA：assets/ui
 * API 已由 feature mount；此处静态资源 + 未匹配路径回退 index.html
 */
import * as fs from 'fs'
import * as path from 'path'
import type { Context, Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { assetPath } from '@/core/paths'

function uiRoot(): string {
  return assetPath('ui')
}

function sendIndex(c: Context) {
  const indexPath = path.join(uiRoot(), 'index.html')
  if (!fs.existsSync(indexPath)) {
    return c.text('UI 未构建。请先运行: pnpm web:build', 503)
  }
  return c.html(fs.readFileSync(indexPath, 'utf8'))
}

/** 须在 API mount 之后调用 */
export function mountSpa(app: Hono): void {
  app.use(
    '/*',
    serveStatic({
      root: uiRoot(),
    }),
  )
  // 前端路由（/bench、/setting…）一律回落 SPA，无需按路由登记
  app.get('*', sendIndex)
}
