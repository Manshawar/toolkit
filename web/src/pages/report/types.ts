export type RepoRow = {
  path: string
  alias: string
  display_name: string
  git_remote: string
  name_custom: boolean
  enabled: boolean
  last_used_at?: string
}

export type ReportSettingView = {
  path: string
  roles: string[]
  role: string
  auto_copy: boolean
  show_roster: boolean
  git_user_email: string
  day_start_max: string
  day_end_min: string
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
