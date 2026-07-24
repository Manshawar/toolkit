/**
 * `tkt usage` + `tkt usage ui`
 */
import { Command } from 'commander'
import { registerUiSubcommand } from '@/server'
import { resolveProvider } from './provider'
import { runOnce, runWatch } from './ui'

function parseIntervalSec(raw: unknown, fallback = 60): number {
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : fallback
  if (!Number.isFinite(n) || n < 5) throw new Error('刷新间隔至少 5 秒')
  return n
}

export async function runUsage(opts: {
  once?: boolean
  interval?: string | number
  provider?: string
}): Promise<void> {
  const provider = resolveProvider(opts.provider)
  if (opts.once) {
    await runOnce(provider)
    return
  }
  await runWatch(provider, parseIntervalSec(opts.interval, 60) * 1000)
}

export function registerUsageCommands(program: Command): void {
  const usage = program
    .command('usage')
    .description('Token 用量（Agent + Token Plan）')
    .option('-o, --once', '查一次')
    .option('-i, --interval <seconds>', '刷新间隔', '60')
    .option('-p, --provider <name>', '覆盖 TKT_PROVIDER')
    .action(async (opts) => {
      try {
        await runUsage(opts)
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })

  registerUiSubcommand(usage, '/usage', '打开用量 UI（/usage）')
}
