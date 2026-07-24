/**
 * git-submit 类型与 CommitPlan schema。
 * 本地 CLI：Vercel AI SDK 生成 Plan → commit（可选 push）。
 */
import { z } from 'zod'

export const CommitItemSchema = z.object({
  message: z.string().min(1),
  // 结构化输出勿用 .default/.optional（部分兼容网关 JSON Schema 不认）
  files: z.array(z.string()),
})

export const CommitPlanSchema = z.object({
  commits: z.array(CommitItemSchema).min(1),
})

export type CommitItem = z.infer<typeof CommitItemSchema>
export type CommitPlan = z.infer<typeof CommitPlanSchema>

export interface GitSubmitOptions {
  dryRun?: boolean
  noPull?: boolean
  /** true = 跳过 push；未指定时由 CLI 询问 */
  noPush?: boolean
  json?: boolean
  cwd?: string
}

export interface FileDiff {
  path: string
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'
  additions: number
  deletions: number
  /** 主 prompt：已压缩+默认截断；资源文件为空或仅占位 */
  patch?: string
  /** tool 分页用：压缩全文（受 MAX_STORE 上限） */
  fullCompressed?: string
  compressedLen?: number
  truncated?: boolean
  /** 图片/字体等资源：仅文件名，不读内容 */
  asset?: boolean
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
  /** 无 HEAD / 无提交历史 → 首提交走 init，跳过 AI */
  noHistory?: boolean
  diff?: DiffInfo
  style?: StyleSummary
  commitPlan?: CommitPlan
  commitHashes?: string[]
  pushed?: boolean
}

export type Step = (ctx: GitSubmitContext) => Promise<GitSubmitContext>
