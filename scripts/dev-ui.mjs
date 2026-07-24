#!/usr/bin/env node
/**
 * 本地联调：Vite (5173) + Hono API (38471)
 * 浏览器开 http://127.0.0.1:5173/ ，/api 已代理到 Node。
 * API 异常退出会自动重启（不拖垮 Vite）。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kids = new Map()

let shuttingDown = false
let apiRestarts = 0

function tagLine(label, chunk, stream) {
  const text = String(chunk)
  for (const line of text.split(/\r?\n/)) {
    if (line === '') continue
    stream.write(`[${label}] ${line}\n`)
  }
}

function run(label, command, args, { onExit } = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
    shell: false,
  })
  child.stdout?.on('data', (c) => tagLine(label, c, process.stdout))
  child.stderr?.on('data', (c) => tagLine(label, c, process.stderr))
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
  run('api', 'pnpm', ['exec', 'tsx', 'watch', 'src/index.ts', 'ui'], {
    onExit(code, signal) {
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

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('ui:dev → http://127.0.0.1:5173/  (API → :38471)')
startApi()
run('web', 'pnpm', ['--dir', 'web', 'dev'], {
  onExit(code) {
    console.error(`[web] exited code=${code}`)
    shutdown(code ?? 1)
  },
})
