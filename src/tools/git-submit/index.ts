/**
 * git-submit 场景 tool 聚合。
 * 新增本场景 tool：在此 merge 即可。
 */
import type { ToolSet } from 'ai'
import type { ToolLoadContext, ToolLoader } from '../types'
import { createDeepInspectDiffTool } from './deep-inspect-diff'

/** 场景：生成 CommitPlan */
export const loadCommitPlanTools: ToolLoader = (ctx: ToolLoadContext): ToolSet => ({
  ...createDeepInspectDiffTool(ctx),
})
