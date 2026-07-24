#!/usr/bin/env node
/**
 * 本地联调：以 web `pnpm dev`（Vite :5173）为主页面；
 * Hono API 在 :38471 后台跑（--no-open，不抢浏览器）。
 * 浏览器开 http://127.0.0.1:5173/ ，/api 已代理到 Node。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_WEB_PORT = 5173
const DEFAULT_API_PORT = 38471
let webUrl = `http://127.0.0.1:${DEFAULT_WEB_PORT}/`
let apiUrl = `http://127.0.0.1:${DEFAULT_API_PORT}/`
let webReady = false
let apiReady = false
const kids = new Map()

let shuttingDown = false
let apiRestarts = 0
let openedBrowser = false

function printBanner() {
  if (shuttingDown) return
  console.log('─'.repeat(56))
  console.log(`前端 (Vite dev, HMR):  ${webUrl}`)
  console.log(`后端 (Hono API only):   ${apiUrl}  [SPA → Vite, 不挂载]`)
  console.log(`/api 代理:             Vite ${webUrl} → ${apiUrl}`)
  console.log(`看 HMR 用前端地址:      ${webUrl}`)
  console.log('─'.repeat(56))
}

function tagLine(label, chunk, stream) {
  const text = String(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue
    stream.write(`[${label}] ${line}\n`)
  }
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* ignore */
  }
}

function run(label, command, args, { onExit, onStdout } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
    shell: false,
  })
  child.stdout?.on('data', (c) => {
    tagLine(label, c, process.stdout)
    onStdout?.(String(c))
  })
  child.stderr?.on('data', (c) => {
    tagLine(label, c, process.stderr)
    // Vite 常把 Local URL 打到 stderr
    onStdout?.(String(c))
  })
  child.on('exit', (code, signal) => {
    kids.delete(label)
    if (shuttingDown) return
    if (onExit) onExit(code, signal)
  })
  kids.set(label, child)
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of kids.values()) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300).unref()
}

function startApi() {
  // 只当 API：不挂载 SPA（开发页走 Vite），不抢浏览器
  run('api', 'pnpm', ['exec', 'tsx', 'watch', 'src/index.ts', 'ui', '--no-open', '--no-spa'], {
    onStdout(text) {
      // API 自打 `tkt ui → http://...`
      const m = text.match(/tkt ui\s*→\s*(https?:\/\/[^\s]+)/)
      if (m) {
        apiUrl = m[1]
        if (!apiReady) {
          apiReady = true
          printBanner()
        }
      }
    },
    onExit(code, signal) {
      apiReady = false
      if (shuttingDown) return
      apiRestarts += 1
      if (apiRestarts > 20) {
        console.error('[api] 重启次数过多，退出')
        shutdown(1)
        return
      }
      const delay = Math.min(4000, 400 * apiRestarts)
      console.error(
        `[api] exited code=${code} signal=${signal || ''} · ${delay}ms 后重启 (#${apiRestarts})`,
      )
      setTimeout(() => {
        if (!shuttingDown) startApi()
      }, delay)
    },
  })
}

function startWeb() {
  run('web', 'pnpm', ['--dir', 'web', 'dev'], {
    onStdout(text) {
      if (!webReady) {
        // Vite 4/5/6: `Local:   http://localhost:5173/` 或 ready in
        const m = text.match(/Local:\s+(https?:\/\/[^\s]+)/i)
        if (m) {
          webUrl = m[1].replace('localhost', '127.0.0.1')
          webReady = true
          printBanner()
        } else if (/ready in/i.test(text)) {
          webReady = true
          printBanner()
        }
      }
      if (!openedBrowser && webReady) {
        openedBrowser = true
        openBrowser(webUrl)
      }
    },
    onExit(code) {
      webReady = false
      console.error(`[web] exited code=${code}`)
      shutdown(code ?? 1)
    },
  })
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('启动 web/dev（Vite）+ API…')
console.log(`默认前端 http://127.0.0.1:${DEFAULT_WEB_PORT}/ · 默认后端 http://127.0.0.1:${DEFAULT_API_PORT}/`)
console.log('(实际端口以两侧 ready 输出为准)')
startApi()
startWeb()
