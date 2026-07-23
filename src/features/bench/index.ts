/**
 * `tkt bench` + `tkt bench ui`
 */
import { Command } from 'commander'
import { startUiServer, DEFAULT_PORT } from '../../server'
import { runBenchCli } from './cli'

function parseConcurrency(raw: unknown): number {
  if (raw === 'all' || raw === '0') return Infinity
  const n = parseInt(String(raw ?? 6), 10)
  return Number.isFinite(n) && n > 0 ? n : 6
}

function parseList(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function registerBenchCommands(program: Command): void {
  const bench = program.command('bench').description('网关模型流式测速（TTFT / Total）')

  bench
    .option('--rounds <n>', '每模型轮数', '1')
    .option('--prompt <text>', '可选 prompt 前缀（仍会加随机防缓存）')
    .option('--models <ids>', '只测这些 id（逗号分隔）')
    .option('--exclude <ids>', '排除 id（逗号分隔）')
    .option('--sort <ttft|total>', '排序：total（默认）或 ttft', 'total')
    .option('-c, --concurrency <n>', '最大同时测几个模型', '6')
    .option('--stagger <ms>', '模型启动间隔 ms', '1000')
    .option('--timeout <ms>', '单请求超时', '120000')
    .option('--json', '输出 JSON')
    .option('--no-save', '不写 history')
    .action(async (opts) => {
      try {
        const sortRaw = String(opts.sort || 'total').toLowerCase()
        await runBenchCli({
          rounds: Math.max(1, parseInt(String(opts.rounds), 10) || 1),
          prompt: opts.prompt || null,
          models: parseList(opts.models).length ? parseList(opts.models) : null,
          exclude: parseList(opts.exclude),
          sortBy: sortRaw === 'ttft' ? 'ttft' : 'total',
          concurrency: parseConcurrency(opts.concurrency),
          staggerMs: Math.max(0, parseInt(String(opts.stagger), 10) || 1000),
          timeoutMs: parseInt(String(opts.timeout), 10) || 120000,
          json: Boolean(opts.json),
          save: opts.save !== false,
        })
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })

  bench
    .command('ui')
    .description('启动本地 UI（同 tkt ui）')
    .option('--port <n>', '端口', String(DEFAULT_PORT))
    .action((opts) => {
      startUiServer({ port: parseInt(String(opts.port), 10) || DEFAULT_PORT })
    })
}
