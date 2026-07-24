/**
 * 本地 AI SDK 生成 CommitPlan；大 diff 默认截断，必要时 deep_inspect_diff 分页吞吐。
 * 无提交历史：固定 `init: 初始化`，不调 AI。
 */
import chalk from 'chalk'
import { createAiClient } from '@/ai'
import { loadTools } from '@/tools'
import { withCatRun } from '@/ui'
import { GitSubmitError } from '../errors'
import { buildCommitPlanUser, loadCommitPlanSystem } from './prompt'
import { CommitPlanSchema, type CommitPlan, type Step } from '../types'

const INIT_PLAN: CommitPlan = {
  commits: [{ message: 'init: 初始化', files: [] }],
}

export const stepAnalyze: Step = async (ctx) => {
  if (!ctx.diff || !ctx.style) throw new GitSubmitError('缺少 diff 或 style')

  // 空仓库首提交：不耗 token
  if (ctx.noHistory) {
    console.log(chalk.dim('→ analyze skipped (init)'))
    logPlan(INIT_PLAN)
    if (ctx.options.dryRun) console.log(chalk.yellow('[dry-run] 跳过 commit / push'))
    return { ...ctx, commitPlan: INIT_PLAN }
  }

  const user = buildCommitPlanUser(ctx.style, ctx.diff.summary)
  const quiet = Boolean(ctx.options.json)

  // 配置拦截在「思考中」之前；client 在动画外创建
  const ai = await createAiClient()
  const plan = await withCatRun(
    'analyze',
    async () => {
      const model = await ai.getModel()
      const tools = loadTools('git-submit.commit-plan', {
        model,
        diff: ctx.diff!,
        cwd: ctx.cwd,
      })
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
  // 与 git log 一致：最新在上（plan 数组末项最后提交 = 最新）
  for (const c of [...plan.commits].reverse()) {
    console.log(chalk.cyan(`  • ${c.message}`))
  }
}
