export type RepoRow = {
  path: string
  alias: string
  display_name: string
  git_remote: string
  name_custom: boolean
  enabled: boolean
  last_used_at?: string
}

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: '周一',
  tue: '周二',
  wed: '周三',
  thu: '周四',
  fri: '周五',
  sat: '周六',
  sun: '周日',
}

export type DayScheduleView = {
  enabled: boolean
  start: string
  end: string
}

export type WorkScheduleView = Record<WeekdayKey, DayScheduleView>

export type ReportSettingView = {
  path: string
  roles: string[]
  role: string
  auto_copy: boolean
  show_roster: boolean
  git_user_email: string
  /** @deprecated 兼容；以 work_schedule 为准 */
  day_start_max: string
  /** @deprecated 兼容；以 work_schedule 为准 */
  day_end_min: string
  work_schedule: WorkScheduleView
  repositories: RepoRow[]
}

export type ReportItem = {
  project: string
  text: string
  hours: number
}

export type ReportRecord = {
  date: string
  role: string
  sheetTime: string
  items: ReportItem[]
  totalHours: number
  targetHours: number
  sessionHours: number
  commitCount: number
  emittedAt: string
}

export type ReportStats = {
  days: number
  totalHours: number
  avgHours: number
  totalCommits: number
  lastDate: string | null
  series: Array<{ date: string; hours: number; commits: number }>
  projects: Array<{ name: string; hours: number; days: number }>
  recent: ReportRecord[]
}

export const REPORT_NAV = [
  { href: '/report', label: '总览', exact: true as boolean },
  { href: '/report/generate', label: '生成', exact: false as boolean },
  { href: '/report/history', label: '归档', exact: false as boolean },
  { href: '/report/roster', label: '名单', exact: false as boolean },
  { href: '/report/prefs', label: '偏好', exact: false as boolean },
] as const
