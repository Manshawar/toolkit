/**
 * bugrelay 服务开关：供 tkt ui（38471）页面控制 9527 服务。
 *
 * start：detached spawn 当前 CLI 的 `bugrelay` 子命令（与 ui 进程解耦，ui 退出服务仍活）；
 * stop：按端口找 pid kill（服务可能由任何终端启动，不能靠子进程句柄）。
 */
import { spawn, execFile } from 'node:child_process'
import { DEFAULT_BUGRELAY_PORT } from './snippet'

export async function isServiceUp(port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/bugrelay/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return resp.ok
  } catch {
    return false
  }
}

export async function startService(port: number): Promise<void> {
  if (await isServiceUp(port)) return
  // argv[1] = 当前 CLI 入口（全局 bin → lib/index.js）；dev 下 tsx 跑 .ts 走 npx tsx
  const entry = process.argv[1] ?? ''
  const child = entry.endsWith('.ts')
    ? spawn('npx', ['tsx', entry, 'bugrelay'], { detached: true, stdio: 'ignore' })
    : spawn(process.execPath, [entry, 'bugrelay'], { detached: true, stdio: 'ignore' })
  child.unref()
  // 等 health 起来（最多 15s）
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isServiceUp(port)) return
  }
  throw new Error(`服务 15s 内未就绪（手动跑 tkt bugrelay 看报错）`)
}

function killPidOnPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('lsof', ['-ti', `tcp:${port}`], { timeout: 5000 }, (err, stdout) => {
      const pid = Number(stdout.trim().split('\n')[0])
      if (err || !pid) return resolve(false)
      try {
        process.kill(pid, 'SIGTERM')
        resolve(true)
      } catch {
        resolve(false)
      }
    })
  })
}

export async function stopService(port: number): Promise<void> {
  if (!(await isServiceUp(port))) return
  if (!(await killPidOnPort(port))) {
    throw new Error(`找不到 :${port} 进程（lsof 失败），请手动停止`)
  }
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300))
    if (!(await isServiceUp(port))) return
  }
  throw new Error('SIGTERM 后服务仍未退出')
}

export function servicePort(): number {
  return Number(process.env.BUGRELAY_PORT) || DEFAULT_BUGRELAY_PORT
}
