/** CommitPlan system prompt（与 `tkt prompt show` 同文件） */
import { loadPrompt } from '../prompts'

export const COMMIT_PLAN_PROMPT_ID = 'git-submit.commit-plan' as const

export function loadCommitPlanSystem(): string {
  return loadPrompt(COMMIT_PLAN_PROMPT_ID)
}

export function buildCommitPlanUser(styleText: string, diffSummary: string): string {
  return `## Style Summary\n${styleText}\n\n## Diff\n${diffSummary}`
}
