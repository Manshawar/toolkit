/** daily-report 配置与类型 */
export const REPORT_ARG = 'report'

export const ROLES = ['前端', '后端', '运维', '测试', '产品'] as const
export type Role = (typeof ROLES)[number]

export type RoleDef = {
  use_git: boolean
  soft_work_categories: string[]
}

export type RepoEntry = {
  path: string
  alias: string
  display_name: string
  git_remote: string
  added_at: string
  last_used_at: string
}

export type ReportSetting = {
  role: string
  auto_copy: boolean | null
  node_available: boolean
  git_user_email: string
  day_start_max: string
  day_end_min: string
  repositories: RepoEntry[]
  role_definitions: Record<string, RoleDef>
  _hint?: string
}

export const DEFAULT_SETTING: ReportSetting = {
  role: '',
  auto_copy: null,
  node_available: true,
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
  _hint:
    'role: 空 → 弹角色选择;auto_copy: null → 弹是否启用剪贴板;day_start_max/day_end_min: 黑心窗;repositories: save-repo 管理',
}

export type CommitItem = { time: number; subject: string }

export type GatherRepoOut = {
  path: string
  alias: string
  display_name: string
  project: string
  items: Array<{ commit: string; time: number }>
  total_hours: number
  total_count: number
}
