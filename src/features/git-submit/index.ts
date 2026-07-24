/**
 * git-submit 入口：`tkt gc` → AI SDK 生成 Plan → commit（可选 push）
 */
import chalk from 'chalk'
import { Command, Option } from 'commander'
import { emitCliError, emitJson, GitSubmitResultSchema } from '@/core/cli'
import { printAutoPushStatus, resolveAutoPush } from './prefs'
import { GitSubmitError } from './errors'
import { runWorkflow } from './run'
import type { GitSubmitOptions } from './types'

export type { GitSubmitOptions, CommitPlan, GitSubmitContext } from './types'
export { CommitPlanSchema } from './types'
export { createContext, runOnce, runWorkflow } from './run'
export { GitSubmitError } from './errors'
export { runAgentGc, AGENT_GC_MAX_ROUNDS, type AgentGcOptions } from './agent-loop'

export async function runGitSubmit(options: GitSubmitOptions): Promise<void> {
  try {
    const ctx = await runWorkflow(options)

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
    console.log(
      chalk.green(
        `完成：${commits.length} 个 commit${
          pushed ? (ctx.isGerrit ? ' + gerrit + push' : ' + push') : ''
        }`,
      ),
    )
  } catch (e) {
    if (e instanceof GitSubmitError && e.code === 'CLEAN') {
      if (options.json) emitCliError({ ok: false, code: 'CLEAN', message: e.message })
      else console.log(chalk.dim(e.message))
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    const code = e instanceof GitSubmitError ? e.code : 'GIT_SUBMIT'
    if (options.json) emitCliError({ ok: false, code, message: msg })
    else console.error(chalk.red(msg))
    process.exitCode = 1
  }
}

/** 注册 `tkt gc` */
export function registerGitSubmitCommands(program: Command): void {
  program
    .command('gc')
    .description('AI 提交：Pull → CommitPlan → Commit（可选 Push）')
    .option('--dry-run', '不提交不推送')
    .option('--no-pull', '跳过 pull')
    .addOption(new Option('--push', '开启自动推送并记住'))
    .addOption(new Option('--no-push', '关闭自动推送并记住'))
    .option('--json', 'JSON 结果')
    .action(async (opts) => {
      const { noPush, enable } = await resolveAutoPush({
        push: Boolean(opts.push),
        noPush: Boolean(opts.noPush),
        json: Boolean(opts.json),
        dryRun: Boolean(opts.dryRun),
      })
      if (!opts.json) printAutoPushStatus(enable)
      await runGitSubmit({
        dryRun: Boolean(opts.dryRun),
        noPull: !opts.pull,
        noPush,
        json: Boolean(opts.json),
      })
    })
}
