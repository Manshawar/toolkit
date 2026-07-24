/**
 * Tool 加载上下文与场景名。
 * 新增场景：在此加 union，并在对应目录注册 loader。
 */
import type { LanguageModel, ToolSet } from 'ai'
import type { DiffInfo } from '@/features/git-submit/types'
import type { GatherResult } from '@/features/report/types'

/** 按业务场景划分；一场景可挂多个 tool */
export type ToolScenario = 'git-submit.commit-plan' | 'report.daily'

export interface ToolLoadContext {
  model: LanguageModel
  /** git-submit 场景需要 */
  diff?: DiffInfo
  cwd?: string
  /** report 场景：可变 gather，tool 采完后合并进去 */
  report?: {
    date: string
    dayStart?: string
    dayEnd?: string
    gather: GatherResult
  }
}

export type ToolLoader = (ctx: ToolLoadContext) => ToolSet
