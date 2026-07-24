/**
 * `tkt agent` — CLI；领域 loop 在 git-submit/agent-loop
 */
import { Command, Option } from 'commander'
import {
  AGENT_GC_MAX_ROUNDS,
  emitGcError,
  emitGcOutcome,
  runAgentGc,
} from '@/features/git-submit'
import { printAutoPushStatus, resolveAutoPush } from '@/features/git-submit/prefs'

export function registerAgentCommands(program: Command): void {
  const agent = program.command('agent').description('本地 agent loop（残留/失败自动重试）')

  agent
    .command('gc')
    .description(`AI 提交 agent loop：最多 ${AGENT_GC_MAX_ROUNDS} 轮直到干净`)
    .option('--dry-run', '不提交不推送')
    .option('--no-pull', '跳过 pull')
    .addOption(new Option('--push', '开启自动推送并记住'))
    .addOption(new Option('--no-push', '关闭自动推送并记住'))
    .option('--json', 'JSON 结果')
    .option('--max-rounds <n>', '最大轮次', String(AGENT_GC_MAX_ROUNDS))
    .action(async (opts) => {
      const { noPush, enable } = await resolveAutoPush({
        push: Boolean(opts.push),
        noPush: Boolean(opts.noPush),
        json: Boolean(opts.json),
        dryRun: Boolean(opts.dryRun),
      })
      if (!opts.json) printAutoPushStatus(enable)
      const maxRounds = Math.max(1, parseInt(String(opts.maxRounds), 10) || AGENT_GC_MAX_ROUNDS)
      const options = {
        dryRun: Boolean(opts.dryRun),
        noPull: !opts.pull,
        noPush,
        json: Boolean(opts.json),
        maxRounds,
      }
      try {
        emitGcOutcome(await runAgentGc(options), options, 'agent')
      } catch (e) {
        emitGcError(e, options, 'AGENT')
      }
    })
}
