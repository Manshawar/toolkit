/**
 * `tkt agent` — CLI 入口；实现在 `@/agent`（client + 工作流 loop）
 *
 * - `tkt gc`：单次
 * - `tkt agent gc`：残留 / 失败最多再跑 5 轮
 */
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { AGENT_MAX_ROUNDS, runAgentGc } from '@/agent'
import { emitCliError, emitJson, GitSubmitResultSchema } from '@/core/cli'
import { GitSubmitError } from '@/features/git-submit/errors'
import { printAutoPushStatus, resolveAutoPush } from '@/features/git-submit/prefs'

export { runAgentGc, AGENT_MAX_ROUNDS } from '@/agent'

async function runAgentGcCli(options: {
  dryRun?: boolean
  noPull?: boolean
  noPush?: boolean
  json?: boolean
  maxRounds?: number
}): Promise<void> {
  try {
    const ctx = await runAgentGc(options)
    const commits = (ctx.commitPlan?.commits ?? []).map((c, i) => ({
      message: c.message,
      hash: ctx.commitHashes?.[i] ?? '',
    }))
    const pushed = Boolean(ctx.pushed)

    if (options.json) {
      emitJson(GitSubmitResultSchema, {
        ok: true as const,
        commits,
        pushed,
        gerrit: ctx.isGerrit,
      })
      return
    }

    if (options.dryRun) {
      console.log(chalk.yellow('dry-run 完成'))
      return
    }

    const left = ctx.leftover?.length ?? 0
    const pushBit = pushed ? (ctx.isGerrit ? ' + gerrit + push' : ' + push') : ''
    const leftBit = left ? ` · 仍有 ${left} 残留` : ''
    console.log(
      chalk.green(`agent 完成：${commits.length} 个 commit${pushBit}`) +
        (left ? chalk.yellow(leftBit) : ''),
    )
  } catch (e) {
    if (e instanceof GitSubmitError && e.code === 'CLEAN') {
      if (options.json) emitCliError({ ok: false, code: 'CLEAN', message: e.message })
      else console.log(chalk.dim(e.message))
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof GitSubmitError ? e.code : 'AGENT'
    if (options.json) emitCliError({ ok: false, code, message: msg })
    else console.error(chalk.red(msg))
    process.exitCode = 1
  }
}

export function registerAgentCommands(program: Command): void {
  const agent = program.command('agent').description('本地 agent loop（残留/失败自动重试）')

  agent
    .command('gc')
    .description(`AI 提交 agent loop：最多 ${AGENT_MAX_ROUNDS} 轮直到干净`)
    .option('--dry-run', '不提交不推送')
    .option('--no-pull', '跳过 pull')
    .addOption(new Option('--push', '开启自动推送并记住'))
    .addOption(new Option('--no-push', '关闭自动推送并记住'))
    .option('--json', 'JSON 结果')
    .option('--max-rounds <n>', '最大轮次', String(AGENT_MAX_ROUNDS))
    .action(async (opts) => {
      const { noPush, enable } = await resolveAutoPush({
        push: Boolean(opts.push),
        noPush: Boolean(opts.noPush),
        json: Boolean(opts.json),
        dryRun: Boolean(opts.dryRun),
      })
      if (!opts.json) printAutoPushStatus(enable)
      const maxRounds = Math.max(1, parseInt(String(opts.maxRounds), 10) || AGENT_MAX_ROUNDS)
      await runAgentGcCli({
        dryRun: Boolean(opts.dryRun),
        noPull: !opts.pull,
        noPush,
        json: Boolean(opts.json),
        maxRounds,
      })
    })
}
