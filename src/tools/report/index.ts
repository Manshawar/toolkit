/** report 场景 tool 聚合 */
import type { ToolSet } from 'ai'
import type { ToolLoadContext, ToolLoader } from '../types'
import { createAddRepoTool } from './add-repo'

export const loadReportDailyTools: ToolLoader = (ctx: ToolLoadContext): ToolSet => ({
  ...createAddRepoTool(ctx),
})
