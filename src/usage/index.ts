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
