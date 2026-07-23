/** CommitPlan：system 来自 prompts/；user 只拼运行时数据 */
import { loadPrompt } from '../prompts'
import type { StyleSummary } from './types'

export const COMMIT_PLAN_PROMPT_ID = 'git-submit.commit-plan' as const
export const AGENT_PREPARE_PROMPT_ID = 'git-submit.agent-prepare' as const

export function loadCommitPlanSystem(): string {
  return loadPrompt(COMMIT_PLAN_PROMPT_ID)
}

export function loadAgentPrepareInstruction(): string {
  return loadPrompt(AGENT_PREPARE_PROMPT_ID)
}

/** Style Summary 仅输出指标与样本，策略文案在 commit-plan.md */
export function formatStyleData(style: StyleSummary): string {
  const types = Object.entries(style.typeDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  return [
    `sampleSize: ${style.sampleSize}`,
    `conventionalRatio: ${style.conventionalRatio.toFixed(2)}`,
    `chineseRatio: ${style.chineseRatio.toFixed(2)}`,
    `avgLength: ${style.avgLength}`,
    `hasPeriodRatio: ${style.hasPeriodRatio.toFixed(2)}`,
    `hasResolveWordRatio: ${style.hasResolveWordRatio.toFixed(2)}`,
    types ? `typeDistribution: ${types}` : 'typeDistribution: (none)',
    `samples: ${JSON.stringify(style.samples)}`,
  ].join('\n')
}

export function buildCommitPlanUser(style: StyleSummary, diffSummary: string): string {
  return `## Style Summary\n${formatStyleData(style)}\n\n## Diff\n${diffSummary}`
}
