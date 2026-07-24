/**
 * CLI：`tkt bench [opts]`
 */
import {
  benchModels,
  fetchModels,
  formatRankTable,
  gatewayConfigPath,
  normalizeApiRoot,
  readEnv,
  saveHistory,
} from './lib'

export type BenchCliOpts = {
  json?: boolean
  save?: boolean
  rounds?: number
  prompt?: string | null
  models?: string[] | null
  exclude?: string[]
  timeoutMs?: number
  sortBy?: 'total' | 'ttft'
  concurrency?: number
  staggerMs?: number
}

function printConfigHelp(): void {
  console.error(`缺少网关配置。任选其一：`)
  console.error(`  1) tkt ui → 打开导航页进入 Bench，填写 Base URL / API Key 并保存`)
  console.error(`  2) 写入 ${gatewayConfigPath()}`)
  console.error(`     {"baseUrl":"https://ai-gateway.example.com","apiKey":"…"}`)
}

export async function runBenchCli(opts: BenchCliOpts = {}): Promise<void> {
  const {
    json = false,
    save = true,
    rounds = 1,
    prompt = null,
    models: onlyModels = null,
    exclude = [],
    timeoutMs = 120000,
    sortBy = 'total',
    concurrency = 6,
    staggerMs = 1000,
  } = opts

  const env = readEnv()
  if (env.missing.length) {
    printConfigHelp()
    process.exitCode = 2
    return
  }
  const apiRoot = normalizeApiRoot(env.baseUrl!)
  let models = onlyModels
  if (!models || !models.length) {
    process.stderr.write('Fetching /v1/models ...\n')
    models = await fetchModels(apiRoot, env.apiKey!, { timeoutMs })
  }
  if (exclude.length) {
    const ex = new Set(exclude)
    models = models.filter((m) => !ex.has(m))
  }
  if (!models.length) {
    console.error('No models to bench.')
    process.exitCode = 1
    return
  }
  process.stderr.write(
    `Benching ${models.length} model(s), rounds=${rounds}, concurrency=${concurrency === Infinity ? 'all' : concurrency}, stagger=${staggerMs}ms ...\n`,
  )
  const bench = await benchModels(apiRoot, env.apiKey!, models, {
    prompt,
    rounds,
    timeoutMs,
    sortBy,
    concurrency,
    staggerMs,
    onProgress: (ev) => {
      if (ev.type === 'model_start') process.stderr.write(`  → ${ev.model}\n`)
      if (ev.type === 'model_done') {
        const r = ev.result
        if (r.ok) {
          process.stderr.write(
            `    ok TTFT=${r.ttftSec!.toFixed(2)}s total=${r.totalSec!.toFixed(2)}s\n`,
          )
        } else process.stderr.write(`    FAIL ${r.error}\n`)
      }
    },
  })
  let historyFile: string | null = null
  if (save) {
    try {
      historyFile = saveHistory(bench)
    } catch (e) {
      process.stderr.write(`history save skipped: ${e instanceof Error ? e.message : String(e)}\n`)
    }
  }
  if (json) {
    console.log(JSON.stringify({ ...bench, historyFile }, null, 2))
  } else {
    console.log(formatRankTable(bench))
    if (historyFile) console.log(`\n(history: ${historyFile})`)
  }
}
