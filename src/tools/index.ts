/**
 * Tool 注册表：按场景加载，避免一次塞进全部 tool。
 *
 * ```
 * src/tools/
 *   index.ts                 # loadTools(scenario, ctx)
 *   types.ts
 *   git-submit/              # 场景目录
 *   report/
 * ```
 *
 * 新增：写 tool 文件 → 场景 index merge → types 里加 ToolScenario → registry 挂上。
 */
import type { ToolSet } from 'ai'
import { loadCommitPlanTools } from './git-submit'
import { loadReportDailyTools } from './report'
import type { ToolLoadContext, ToolLoader, ToolScenario } from './types'

export type { ToolLoadContext, ToolScenario } from './types'

const registry: Record<ToolScenario, ToolLoader> = {
  'git-submit.commit-plan': loadCommitPlanTools,
  'report.daily': loadReportDailyTools,
}

/** 按场景加载 ToolSet；未知场景返回空对象 */
export function loadTools(scenario: ToolScenario, ctx: ToolLoadContext): ToolSet {
  const loader = registry[scenario]
  if (!loader) {
    console.warn(`[tools] 未知场景: ${scenario}`)
    return {}
  }
  return loader(ctx)
}

/** 列出已注册场景（调试用） */
export function listToolScenarios(): ToolScenario[] {
  return Object.keys(registry) as ToolScenario[]
}
