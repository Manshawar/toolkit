#!/usr/bin/env node
/**
 * tkt CLI
 *
 * ```
 * src/
 *   agent/              Vercel AI SDK + config
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
import { registerUsageCommands } from './features/usage'
import { registerGitSubmitCommands } from './features/git-submit'
import { registerAgentCommands } from './features/agent'
import { registerBenchCommands } from './features/bench'
import { registerReportCommands } from './features/report'
import { runPromptList, runPromptShow } from './features/prompts'
import { reconfigureAiConfig, showAiConfig } from './agent'
import { interceptCliUpdate } from './core/update-check'
import { startUiServer, registerUiSubcommand, DEFAULT_PORT } from './server'

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

  registerUsageCommands(program)

  const prompt = program.command('prompt').description('提取 AI prompt')
  prompt
    .command('list')
    .option('--json', 'JSON')
    .action((o) => runPromptList({ json: Boolean(o.json) }))
  prompt
    .command('show <id>')
    .option('--json', 'JSON')
    .action((id: string, o) => runPromptShow(id, { json: Boolean(o.json) }))

  const configCmd = program
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
  registerUiSubcommand(configCmd, '/setting', '打开 AI 配置 UI（/setting）')

  registerGitSubmitCommands(program)
  registerAgentCommands(program)
  registerBenchCommands(program)
  registerReportCommands(program)

  program
    .command('ui')
    .description('本地工具台导航页（Hono 单端口 SPA）')
    .option('--port <n>', '端口', String(DEFAULT_PORT))
    .option('--no-open', '不自动打开浏览器')
    .option('--path <route>', '打开指定路由，如 /report', '/')
    .action((opts) => {
      startUiServer({
        port: parseInt(String(opts.port), 10) || DEFAULT_PORT,
        path: typeof opts.path === 'string' ? opts.path : '/',
        open: opts.open !== false,
      })
    })

  program.version(pkg.version, '-v, --vers')
  program.parse(process.argv)
}

main().catch(console.error)
