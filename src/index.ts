#!/usr/bin/env node
/**
 * tkt CLI
 *
 * ```
 * src/
 *   ai/                 Vercel AI SDK
 *   core/               paths / env / git / cli
 *   server/             Hono 单端口 UI
 *   ui/                 CLI spinner
 *   tools/              AI tools
 *   features/           一命令一目录（git-submit / bench / …）
 *
 * 跨模块 import：`@/*` → `src/*`（见 tsconfig paths / tsup alias）
 * ```
 */
import * as path from 'path'
import { fileURLToPath } from 'url'
import { config as loadDotenv } from 'dotenv'
import { Command } from 'commander'
import { runGrp } from './features/grp'
import { runServe } from './features/sv'
import { runUsage } from './features/usage'
import { registerGitSubmitCommands } from './features/git-submit'
import { registerBenchCommands } from './features/bench'
import { registerReportCommands } from './features/report'
import { runPromptList, runPromptShow } from './features/prompts'
import { reconfigureAiConfig, showAiConfig } from './ai'
import { interceptCliUpdate } from './core/update-check'
import { startUiServer, DEFAULT_PORT } from './server'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadDotenv({ path: path.join(packageRoot, '.env'), quiet: true })

async function main() {
  interceptCliUpdate()
  const pkg = (await import('../package.json')).default
  const program = new Command(pkg.commandName)

  program.command('grp').description('Gerrit: HEAD:refs/for/<branch>').action(() => runGrp())
  program
    .command('sv [nodeVersion]')
    .description('fnm 切 Node 后 npm run serve')
    .action((v?: string) => runServe(v))

  program
    .command('usage')
    .description('Token Plan 用量')
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

  const prompt = program.command('prompt').description('提取 AI prompt')
  prompt
    .command('list')
    .option('--json', 'JSON')
    .action((o) => runPromptList({ json: Boolean(o.json) }))
  prompt
    .command('show <id>')
    .option('--json', 'JSON')
    .action((id: string, o) => runPromptShow(id, { json: Boolean(o.json) }))

  program
    .command('config')
    .description('重新填写 AI 配置（有值覆盖，空回车保留）')
    .option('--show', '只查看当前配置（Key 脱敏）')
    .action(async (opts) => {
      try {
        if (opts.show) showAiConfig()
        else await reconfigureAiConfig()
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e))
        process.exitCode = 1
      }
    })

  registerGitSubmitCommands(program)
  registerBenchCommands(program)
  registerReportCommands(program)

  program
    .command('ui')
    .description('本地 HTML 工具页（Hono 单端口）')
    .option('--port <n>', '端口', String(DEFAULT_PORT))
    .action((opts) => {
      startUiServer({ port: parseInt(String(opts.port), 10) || DEFAULT_PORT })
    })

  program.version(pkg.version, '-v, --vers')
  program.parse(process.argv)
}

main().catch(console.error)
