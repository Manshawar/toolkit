/**
 * git-submit 入口：`tkt gc` → 单次 Plan → commit（可选 push）
 */
import { Command, Option } from 'commander'
import { printAutoPushStatus, resolveAutoPush } from './prefs'
import { emitGcError, emitGcOutcome } from './cli'
import { runWorkflow } from './run'
import type { GitSubmitOptions } from './types'

export type { GitSubmitOptions, CommitPlan, GitSubmitContext } from './types'
export { CommitPlanSchema } from './types'
export { createContext, runOnce, runWorkflow } from './run'
export { GitSubmitError } from './errors'
export { runAgentGc, AGENT_GC_MAX_ROUNDS, type AgentGcOptions } from './agent-loop'
export { emitGcOutcome, emitGcError, logLeftoverPaths } from './cli'

export async function runGitSubmit(options: GitSubmitOptions): Promise<void> {
  try {
    const ctx = await runWorkflow(options)
    emitGcOutcome(ctx, options, 'gc')
  } catch (e) {
    emitGcError(e, options)
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
