/**
 * git-submit 类型与 CommitPlan schema。
 *
 * - local：CLI 调 Vercel AI SDK 生成 Plan
 * - agent：Skill prepare 出 envelope / apply 注入已校验 Plan
 */
import { z } from 'zod'

export type AiMode = 'local' | 'agent'

export const CommitItemSchema = z.object({
  message: z.string().min(1),
  files: z.array(z.string()).default([]),
})

export const CommitPlanSchema = z.object({
  commits: z.array(CommitItemSchema).min(1),
})

export type CommitItem = z.infer<typeof CommitItemSchema>
export type CommitPlan = z.infer<typeof CommitPlanSchema>

export interface GitSubmitOptions {
  ai: AiMode
  dryRun?: boolean
  noPull?: boolean
  /** true = 跳过 push；未指定时由 CLI 询问 */
  noPush?: boolean
  /** 只输出 AgentEnvelope，不提交 */
  prepare?: boolean
  /** Skill apply：已 zod 校验的 Plan */
  commitPlan?: CommitPlan
  json?: boolean
  cwd?: string
}

export interface FileDiff {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'
  additions: number
  deletions: number
  /** 主 prompt：已压缩+默认截断 */
  patch?: string
  /** tool 分页用：压缩全文（受 MAX_STORE 上限） */
  fullCompressed?: string
  compressedLen?: number
  truncated?: boolean
}

export interface DiffInfo {
  files: FileDiff[]
  summary: string
  hasChanges: boolean
  /** 主 summary 是否总预算截断 */
  summaryTruncated?: boolean
}

export interface StyleSummary {
  sampleSize: number
  conventionalRatio: number
  typeDistribution: Record<string, number>
  avgLength: number
  chineseRatio: number
  hasPeriodRatio: number
  hasResolveWordRatio: number
  text: string
  samples: string[]
}

export interface GitSubmitContext {
  cwd: string
  repo: string
  branch: string
  options: GitSubmitOptions
  isGerrit?: boolean
  diff?: DiffInfo
  style?: StyleSummary
  commitPlan?: CommitPlan
  commitHashes?: string[]
  pushed?: boolean
}

export type Step = (ctx: GitSubmitContext) => Promise<GitSubmitContext>
