#!/usr/bin/env node

import * as path from 'path'
import { fileURLToPath } from 'url'
import { config as loadDotenv } from 'dotenv'
import { Command } from 'commander'
import { runGrp } from './grp'
import { runServe } from './sv'
import { runUsage } from './usage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 源码 src/ → .. ；打包 lib/ → ..
const packageRoot = path.resolve(__dirname, '..')
loadDotenv({ path: path.join(packageRoot, '.env'), quiet: true })

async function main() {
  const pkg = (await import('../package.json')).default
  const program = new Command(pkg.commandName)

  program
    .command('grp')
    .description('Gerrit 推送 HEAD:refs/for/<branch>')
    .action(() => runGrp())

  program
    .command('sv [nodeVersion]')
    .description('按需切换 Node 版本后执行 npm run serve')
    .action((nodeVersion?: string) => runServe(nodeVersion))

  program
    .command('usage')
    .description('Token Plan 用量（默认每分钟刷新）')
    .option('-o, --once', '只查一次后退出')
    .option('-i, --interval <seconds>', '刷新间隔秒数，默认 60')
    .option('-p, --provider <name>', '覆盖 TKT_PROVIDER，如 minimax')
    .action(async (opts) => {
      try {
        await runUsage(opts)
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })

  program.version(pkg.version, '-v, --vers')
  program.parse(process.argv)
}

main().catch(console.error)
