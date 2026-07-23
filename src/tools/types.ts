/**
 * Tool 加载上下文与场景名。
 * 新增场景：在此加 union，并在对应目录注册 loader。
 */
import type { LanguageModel, ToolSet } from 'ai'
import type { DiffInfo } from '../features/git-submit/types'

/** 按业务场景划分；一场景可挂多个 tool */
export type ToolScenario = 'git-submit.commit-plan'

export interface ToolLoadContext {
  model: LanguageModel
  /** git-submit 场景需要 */
  diff?: DiffInfo
  cwd?: string
}

export type ToolLoader = (ctx: ToolLoadContext) => ToolSet
