/**
 * 生成 CommitPlan：
 * - 已有 plan（Skill apply）→ 校验后沿用
 * - prepare → 输出 AgentEnvelope
 * - local → AI SDK；大 diff 默认截断，必要时 deep_inspect_diff 分页吞吐
 */
import chalk from 'chalk'
import { createAiClient } from '../../ai'
import { emitAgentEnvelope, parseWithSchema } from '../../lib/cli'
import { loadTools } from '../../tools'
import { withSpinner } from '../../ui'
import { GitSubmitError } from './errors'
import {
  COMMIT_PLAN_PROMPT_ID,
  buildCommitPlanUser,
  loadAgentPrepareInstruction,
  loadCommitPlanSystem,
} from './prompt'
import { CommitPlanSchema, type Step } from './types'

export const stepAnalyze: Step = async (ctx) => {
  if (!ctx.diff || !ctx.style) throw new GitSubmitError('缺少 diff 或 style')

  const promptId = COMMIT_PLAN_PROMPT_ID
  const user = buildCommitPlanUser(ctx.style, ctx.diff.summary)
  const context = {
    repo: ctx.repo,
    branch: ctx.branch,
    style: ctx.style,
    files: ctx.diff.files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      truncated: f.truncated,
      compressedLen: f.compressedLen,
    })),
    diffSummary: ctx.diff.summary,
    user,
  }

  if (ctx.options.commitPlan) {
    const plan = parseWithSchema(CommitPlanSchema, ctx.options.commitPlan, 'CommitPlan')
    logPlan(plan)
    return { ...ctx, commitPlan: plan }
  }

  if (ctx.options.ai === 'agent' && ctx.options.prepare) {
    emitAgentEnvelope({
      ok: true,
      mode: 'agent',
      task: promptId,
      promptId,
      promptCommand: `tkt prompt show ${promptId}`,
      json: true,
      context,
      instruction: loadAgentPrepareInstruction(),
      next: 'tkt agent git-submit apply --plan-file <plan.json>',
    })
    return { ...ctx, commitPlan: undefined }
  }

  if (ctx.options.ai !== 'local') {
    throw new GitSubmitError('agent 模式请用: tkt agent git-submit prepare | apply')
  }

  const quiet = Boolean(ctx.options.json)
  const plan = await withSpinner(
    'analyze',
    async (spin) => {
      spin.update('analyze · model')
      const ai = await createAiClient()
      const model = await ai.getModel()
      const tools = loadTools('git-submit.commit-plan', {
        model,
        diff: ctx.diff!,
        cwd: ctx.cwd,
      })
      spin.update('analyze · CommitPlan')
      return ai.generateObject({
        schema: CommitPlanSchema,
        system: loadCommitPlanSystem(),
        user,
        tools,
        maxSteps: 6,
      })
    },
    { quiet },
  )

  logPlan(plan)
  if (ctx.options.dryRun) console.log(chalk.yellow('[dry-run] 跳过 commit / push'))
  return { ...ctx, commitPlan: plan }
}

function logPlan(plan: { commits: Array<{ message: string }> }): void {
  console.log(chalk.dim(`  plan: ${plan.commits.length} commit(s)`))
  for (const c of plan.commits) console.log(chalk.cyan(`  • ${c.message}`))
}
