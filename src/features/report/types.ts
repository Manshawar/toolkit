/**
 * tkt report — 本地 AI 编排日报
 * 流程：偏好 → gather commits → AI Plan → emit（归档/剪贴板）
 */
import { z } from 'zod'

export const REPORT_ARG = 'report'
export const ROLES = ['前端', '后端', '运维', '测试', '产品'] as const
export type Role = (typeof ROLES)[number]

export type RoleDef = {
  use_git: boolean
  soft_work_categories: string[]
}

export type RepoEntry = {
  path: string
  /** 目录名 / 短名（名单左侧） */
  alias: string
  /** 日报用中文名（名单中间，可改；按 remote 猜一次后记住） */
  display_name: string
  git_remote: string
  /** 勾选后才参与今日 gather；默认 true，可在启动名单里空格取消 */
  enabled: boolean
  added_at: string
  last_used_at: string
}

export type ReportSetting = {
  role: string
  auto_copy: boolean | null
  git_user_email: string
  day_start_max: string
  day_end_min: string
  repositories: RepoEntry[]
  role_definitions: Record<string, RoleDef>
}

export const DEFAULT_SETTING: ReportSetting = {
  role: '',
  auto_copy: null,
  git_user_email: '',
  day_start_max: '09:30',
  day_end_min: '20:30',
  repositories: [],
  role_definitions: {
    前端: {
      use_git: true,
      soft_work_categories: ['联调', '提测', 'UI 走查', 'code review', '配合后端'],
    },
    后端: {
      use_git: true,
      soft_work_categories: ['接口对齐', '性能优化', '排查线上问题', 'code review', '配合前端'],
    },
    运维: { use_git: false, soft_work_categories: ['升级', '备份', '监控', '配合客户'] },
    测试: {
      use_git: false,
      soft_work_categories: ['走查', '复现 bug', '配合开发排查', '验收', '回归'],
    },
    产品: {
      use_git: false,
      soft_work_categories: ['需求评审', '写 PRD', '用户访谈', '走查', '验收'],
    },
  },
}

export type GatherRepo = {
  path: string
  alias: string
  display_name: string
  project: string
  commits: string[]
  hours: number
}

export type GatherResult = {
  date: string
  repos: GatherRepo[]
  sessionHours: number
  commitCount: number
}

/** 勿用 .optional/.default（部分网关 JSON Schema 不认） */
export const DailyPlanSchema = z.object({
  items: z
    .array(
      z.object({
        project: z.string().min(1),
        text: z.string().min(1),
        hours: z.number(),
      }),
    )
    .min(1),
  sheetTime: z.string().min(1),
  displayNames: z.array(z.object({ path: z.string(), name: z.string() })),
})

export type DailyPlan = z.infer<typeof DailyPlanSchema>

/** 归档 / 报表用记录（history/YYYY-MM-DD.json） */
export type ReportRecord = {
  date: string
  role: string
  sheetTime: string
  items: Array<{ project: string; text: string; hours: number }>
  totalHours: number
  targetHours: number
  sessionHours: number
  commitCount: number
  emittedAt: string
}

export type ReportOptions = {
  date?: string
  dayStart?: string
  dayEnd?: string
  userRepos?: string[]
  append?: string[]
  targetHours?: number
  role?: string
  noClipboard?: boolean
  dryRun?: boolean
  json?: boolean
}
