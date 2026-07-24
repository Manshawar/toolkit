import chalk from 'chalk'
import type { QuotaWindow, UsageProvider, UsageSnapshot } from './types'
import { formatDuration } from './format'

const BAR_WIDTH = 28

function pad(str: string, width: number): string {
  const len = [...str].length
  return len >= width ? str : str + ' '.repeat(width - len)
}

function barColor(pct: number) {
  if (pct >= 60) return chalk.green
  if (pct >= 30) return chalk.yellow
  return chalk.red
}

function renderBar(pct: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * BAR_WIDTH)
  const color = barColor(pct)
  return color('█'.repeat(filled)) + chalk.dim('░'.repeat(BAR_WIDTH - filled))
}

function renderWindow(w: QuotaWindow): string[] {
  const pct = `${Math.round(w.remainingPercent)}%`.padStart(4)
  const lines = [
    `  ${pad(w.label, 10)} ${renderBar(w.remainingPercent)}  ${barColor(w.remainingPercent)(pct)} 剩余`,
  ]
  const detail: string[] = []
  if (w.remainsMs != null) detail.push(`还剩 ${formatDuration(w.remainsMs)}`)
  if (w.resetAt) detail.push(`重置 ${w.resetAt.toLocaleString('zh-CN')}`)
  if (w.total && w.total > 0) detail.push(`计数 ${w.used ?? 0}/${w.total}`)
  if (detail.length) lines.push(chalk.dim(`             ${detail.join(' · ')}`))
  return lines
}

function renderSnapshot(
  snapshot: UsageSnapshot | null,
  error: Error | null,
  opts: { nextInMs: number; intervalMs: number; once?: boolean },
): string {
  const width = 56
  const rule = (c: string) => chalk.cyan(c.repeat(width))
  const rows: string[] = [rule('─')]

  rows.push(
    chalk.bold.cyan('  tkt usage') +
      chalk.dim(' · ') +
      chalk.white(snapshot?.displayName || '…') +
      (opts.once ? '' : chalk.dim(` · 每 ${Math.round(opts.intervalMs / 1000)}s 刷新`)),
  )

  if (opts.once) {
    rows.push(chalk.dim('  单次查询'))
  } else {
    const nextSec = Math.max(0, Math.ceil(opts.nextInMs / 1000))
    rows.push(chalk.dim(`  下次刷新 ${String(nextSec).padStart(2, ' ')}s · Ctrl+C 退出`))
  }
  rows.push(rule('─'))

  if (error) {
    rows.push(chalk.red(`  ✗ ${error.message}`))
    if (snapshot) rows.push(chalk.dim('  （显示上次成功结果）'))
  }

  if (snapshot) {
    rows.push(chalk.dim(`  更新于 ${snapshot.fetchedAt.toLocaleTimeString('zh-CN')}`))
    rows.push('')
    for (const model of snapshot.models) {
      const meta = model.meta
        ? '  ' + Object.entries(model.meta).map(([k, v]) => chalk.magenta(`${k} ${v}`)).join('  ')
        : ''
      rows.push(chalk.bold.white(`  ▸ ${model.name}`) + meta)
      for (const w of model.windows) rows.push(...renderWindow(w))
      rows.push('')
    }
  } else if (!error) {
    rows.push(chalk.dim('  加载中…'))
  }

  rows.push(rule('─'))
  return rows.join('\n')
}

let paintedLines = 0

function paint(frame: string) {
  const lines = frame.split('\n')
  let out = paintedLines > 0 ? `\x1b[${paintedLines}A` : ''
  for (const line of lines) out += `${line}\x1b[K\n`
  if (paintedLines > lines.length) out += '\x1b[J'
  process.stdout.write(out)
  paintedLines = lines.length
}

export async function runOnce(provider: UsageProvider) {
  const snapshot = await provider.fetchUsage()
  paintedLines = 0
  process.stdout.write(
    renderSnapshot(snapshot, null, { nextInMs: 0, intervalMs: 0, once: true }) + '\n',
  )
}

export async function runWatch(provider: UsageProvider, intervalMs: number) {
  let snapshot: UsageSnapshot | null = null
  let error: Error | null = null
  let nextFetchAt = 0
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    process.stdout.write('\x1b[?25h\n')
    process.exit(0)
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.stdout.write('\x1b[?25l')
  paintedLines = 0

  while (!stopped) {
    if (Date.now() >= nextFetchAt) {
      try {
        snapshot = await provider.fetchUsage()
        error = null
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e))
      }
      nextFetchAt = Date.now() + intervalMs
    }

    paint(
      renderSnapshot(snapshot, error, {
        nextInMs: nextFetchAt - Date.now(),
        intervalMs,
      }),
    )
    await new Promise<void>((r) => setTimeout(r, 1000))
  }
}
