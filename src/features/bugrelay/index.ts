/**
 * tkt bugrelay —— AI 辅助 bug 归属分析服务。
 *
 * 固定 9527（adb reverse / collector 默认地址要求端口稳定），占用报错不顺延；
 * BUGRELAY_PORT 可覆盖（iOS 局域网场景）。监听 0.0.0.0（手机经局域网 IP 可达）。
 *
 * 子命令：
 *   tkt bugrelay            启动服务（长驻），打印接入指引
 *   tkt bugrelay ui         起服务 + 开浏览器 /bugrelay
 *   tkt bugrelay doctor     自检：端口 / claude / adb / 在线会话
 *   tkt bugrelay snippet    输出注入 snippet（含局域网 IP），复制到剪贴板
 */
import { createServer } from 'node:net'
import { spawn, execFile } from 'node:child_process'
import chalk from 'chalk'
import type { Command } from 'commander'
import { serve, upgradeWebSocket } from '@hono/node-server'
import { WebSocketServer } from 'ws'
import { createApp } from '@/server'
import { mountSpa } from '@/server/spa'
import { startIdleSweep } from './session'
import { registerBugrelayWs } from './routes'
import { addSourceDir, readSettings, settingPath } from './settings'
import { buildSnippet, lanIp, DEFAULT_BUGRELAY_PORT } from './snippet'

function resolvePort(optsPort?: string): number {
  return (
    Number(process.env.BUGRELAY_PORT) ||
    (optsPort ? Number(optsPort) : 0) ||
    DEFAULT_BUGRELAY_PORT
  )
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true))
    })
  })
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    /* ignore */
  }
}

function printGuide(port: number): void {
  const ip = lanIp()
  console.log('')
  console.log(chalk.bold('接入指引（4 步）：'))
  console.log(`  1. 目标项目 index.html <head> 最前贴 snippet：${chalk.cyan('tkt bugrelay snippet')}`)
  console.log('  2. 连通：PC webview 零配置 / Android ' + chalk.cyan('adb reverse tcp:9527 tcp:9527'))
  if (ip) {
    console.log(`     iOS / 无 USB：页面 URL 加 ${chalk.cyan(`?bugrelay_server=http://${ip}:${port}`)}`)
  }
  console.log(`  3. 挂源码：${chalk.cyan('tkt bugrelay --add-dir <目标项目 src>')}（AI 定位 file:line）`)
  console.log(`  4. 验证：${chalk.cyan('tkt bugrelay doctor')} + 手机端浮层圆钮变绿`)
  console.log('')
}

export async function startBugrelayServer(opts: { port: number; open: boolean }): Promise<void> {
  const { port, open } = opts
  // 固定口：占用直接报错不顺延（adb reverse 要求端口稳定）
  if (!(await canListen(port))) {
    console.error(chalk.red(`端口 ${port} 被占用。bugrelay 固定端口不顺延（adb reverse 依赖）。`))
    console.error(`释放占用，或用 BUGRELAY_PORT=<port> 覆盖（snippet/collector 会随之变化）`)
    process.exitCode = 1
    return
  }

  startIdleSweep()
  // SPA 兜底 get('*') 按注册顺序优先于后挂的静态路由——ws 必须先于 mountSpa 注册
  const app = createApp({ mountSpa: false })
  // node-server v2 原生 ws：wss 挂在 serve 上统一接管 upgrade（仅 /bugrelay/ws 命中 helper）
  const wss = new WebSocketServer({ noServer: true })
  registerBugrelayWs(app, upgradeWebSocket)
  mountSpa(app)

  serve(
    { fetch: app.fetch, hostname: '0.0.0.0', port, websocket: { server: wss } },
    (info) => {
      const ip = lanIp()
      console.log(chalk.green(`bugrelay → http://127.0.0.1:${info.port}/bugrelay`))
      if (ip) console.log(`局域网  → http://${ip}:${info.port}/bugrelay`)
      const settings = readSettings()
      console.log(
        `add_dirs: ${settings.addDirs.length ? settings.addDirs.join(', ') : chalk.dim('（未配置，--add-dir 追加）')}`,
      )
      if (open) openBrowser(`http://127.0.0.1:${info.port}/bugrelay`)
      printGuide(info.port)
      console.log('Ctrl+C to stop.')
    },
  )
}

async function runDoctor(port: number): Promise<void> {
  let fail = 0
  const line = (ok: boolean, label: string, detail = '') => {
    console.log(`${ok ? chalk.green('✓') : chalk.red('✗')} ${label}${detail ? chalk.dim(` — ${detail}`) : ''}`)
    if (!ok) fail++
  }

  // 1. 服务 / 端口
  let health: { online?: number; sessions?: number } | null = null
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/bugrelay/api/health`)
    health = (await resp.json()) as { online?: number; sessions?: number }
    line(true, `服务在线 (:${port})`, `会话 ${health?.sessions ?? 0} · 在线 ${health?.online ?? 0}`)
  } catch {
    const free = await canListen(port)
    line(false, `服务未启动 (:${port})`, free ? '运行 tkt bugrelay 启动' : '端口被其他进程占用')
  }

  // 2. claude CLI
  const claudeVer = await new Promise<string | null>((resolve) => {
    execFile('claude', ['--version'], { timeout: 10_000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim())
    })
  })
  line(Boolean(claudeVer), 'claude CLI', claudeVer ?? '未安装/未登录，AI 分析不可用')

  // 3. adb
  const adb = await new Promise<string | null>((resolve) => {
    execFile('adb', ['devices'], { timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null)
      const devices = stdout
        .split('\n')
        .slice(1)
        .filter((l) => l.trim() && !l.startsWith('*') && l.includes('device'))
      resolve(`${devices.length} 台设备`)
    })
  })
  line(adb !== null, 'adb', adb ?? '未安装（仅 Android 真机需要）')

  // 4. add_dirs
  const settings = readSettings()
  line(
    settings.addDirs.length > 0,
    'add_dirs 源码目录',
    settings.addDirs.length ? settings.addDirs.join(', ') : `tkt bugrelay --add-dir <src>（${settingPath()}）`,
  )

  if (fail) {
    console.log(chalk.yellow(`\n${fail} 项未通过`))
    process.exitCode = 1
  } else {
    console.log(chalk.green('\n全部通过'))
  }
}

export function registerBugrelayCommands(program: Command): void {
  const bugrelay = program
    .command('bugrelay')
    .description('AI 辅助 bug 归属分析（ws 采集 + Claude 分析，固定 :9527）')
    .option('--port <n>', '端口（默认 9527，占用报错不顺延）')
    .option('--add-dir <path>', '追加 AI 可读源码目录（持久化，可多次）', (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option('--no-open', '只起服务不弹浏览器（默认不弹）')
    .action(async (opts: { port?: string; addDir: string[] }) => {
      try {
        for (const d of opts.addDir ?? []) {
          const { dir } = addSourceDir(d)
          console.log(`add_dir + ${dir}`)
        }
        await startBugrelayServer({ port: resolvePort(opts.port), open: false })
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })

  bugrelay
    .command('ui')
    .description('起服务并打开分析页（/bugrelay）')
    .option('--port <n>', '端口（默认 9527）')
    .action(async (opts: { port?: string }) => {
      await startBugrelayServer({ port: resolvePort(opts.port), open: true })
    })

  bugrelay
    .command('doctor')
    .description('自检：端口 / claude CLI / adb / add_dirs / 在线会话')
    .option('--port <n>', '端口（默认 9527）')
    .action(async (opts: { port?: string }) => {
      await runDoctor(resolvePort(opts.port))
    })

  bugrelay
    .command('snippet')
    .description('输出 index.html 注入 snippet（复制到剪贴板）')
    .option('--port <n>', '端口（默认 9527）')
    .action(async (opts: { port?: string }) => {
      const port = resolvePort(opts.port)
      const snippet = buildSnippet(port)
      console.log(snippet)
      const ip = lanIp()
      console.log(chalk.dim(`\n贴到目标项目 index.html <head> 最前。`))
      if (ip) {
        console.log(chalk.dim(`iOS / 无 adb：页面 URL 加 ?bugrelay_server=http://${ip}:${port}`))
      }
      try {
        const clipboard = (await import('clipboardy')).default
        await clipboard.write(snippet)
        console.log(chalk.green('已复制到剪贴板'))
      } catch {
        /* 无剪贴板环境忽略 */
      }
    })
}
