/**
 * UI / API 无交互生成日报
 * - 不扫 cwd、不跑名单交互
 * - 只扫 setting 已有仓库（enabled），或用户显式传入路径
 */
import * as fs from 'fs'
import * as path from 'path'
import { fillMissingDisplayNames, generateDailyPlan } from './ai'
import {
  assertPlan,
  deliver,
  formatDaily,
  halfHour,
  normalizeSheetTime,
} from './deliver'
import { gatherToday } from './gather'
import { isGitRepo, tryExec } from './gather/git'
import { maxDayHours, resolveWorkWindow } from './hours'
import { ensurePrefs } from './prefs'
import { isoNow, loadSetting, writeSetting } from './setting'
import type { ReportRecord, RepoEntry } from './types'

export type GenerateReportInput = {
  date?: string
  /** 显式仓库路径；空则用 setting 里 enabled */
  paths?: string[]
  append?: string
  role?: string
  /** UI 默认不抢剪贴板 */
  clipboard?: boolean
}

export type GenerateReportResult = {
  record: ReportRecord
  dailyText: string
  historyFile: string | null
  copied: boolean
  sheetTime: string
  gather: { repos: number; commitCount: number; sessionHours: number }
}

function remoteOf(repoPath: string): string {
  return tryExec(`git -C "${repoPath}" config --get remote.origin.url`)
}

/** 把路径写入名单（已有则启用），返回绝对路径 */
export function ensureRepoOnRoster(raw: string): string {
  const abs = path.resolve(raw.trim())
  if (!abs || !fs.existsSync(abs)) throw new Error(`路径不存在: ${raw}`)
  if (!isGitRepo(abs)) throw new Error(`不是 git 仓库: ${abs}`)

  const setting = loadSetting()
  const now = isoNow()
  const idx = setting.repositories.findIndex((r) => r.path === abs)
  if (idx >= 0) {
    setting.repositories[idx]!.enabled = true
    setting.repositories[idx]!.last_used_at = now
    if (!setting.repositories[idx]!.git_remote) {
      setting.repositories[idx]!.git_remote = remoteOf(abs)
    }
  } else {
    const entry: RepoEntry = {
      path: abs,
      alias: path.basename(abs),
      display_name: '',
      git_remote: remoteOf(abs),
      enabled: true,
      added_at: now,
      last_used_at: now,
    }
    setting.repositories.push(entry)
  }
  writeSetting(setting)
  return abs
}

function resolveOnlyPaths(paths?: string[]): string[] {
  if (paths?.length) {
    return paths.map((p) => ensureRepoOnRoster(p))
  }
  const enabled = loadSetting()
    .repositories.filter((r) => r.enabled)
    .map((r) => r.path)
  if (!enabled.length) {
    throw new Error('名单无启用仓库：请在日报→名单勾选，或输入仓库路径')
  }
  return enabled
}

export async function generateReportUi(
  input: GenerateReportInput = {},
): Promise<GenerateReportResult> {
  const prefs = await ensurePrefs({ role: input.role })
  if (!prefs.useGit) {
    throw new Error(`角色「${prefs.role}」未启用 git 采集，请改角色或用 CLI 附带补充`)
  }

  const date = input.date || new Date().toISOString().slice(0, 10)
  const onlyPaths = resolveOnlyPaths(input.paths)
  const setting = loadSetting()
  const { dayStart, dayEnd } = resolveWorkWindow(setting, date)
  const append = input.append?.trim() ? [input.append.trim()] : []

  let repos = setting.repositories.filter((r) =>
    onlyPaths.includes(path.resolve(r.path)),
  )
  repos = await fillMissingDisplayNames(repos, { quiet: true })

  const gather = gatherToday({
    date,
    dayStart,
    dayEnd,
    onlyPaths,
  })

  const targetHours = maxDayHours(dayStart, dayEnd)
  const plan = await generateDailyPlan({
    role: prefs.role,
    categories: prefs.categories,
    targetHours,
    gather,
    append,
    dayStart,
    dayEnd,
    quiet: true,
  })

  plan.items = plan.items.map((it) => ({
    ...it,
    hours: halfHour(it.hours),
    project: it.project.trim() || '通用',
    text: it.text.trim(),
  }))
  assertPlan(plan, targetHours)

  const out = deliver({
    plan,
    date,
    role: prefs.role,
    targetHours,
    sessionHours: gather.sessionHours,
    commitCount: gather.commitCount,
    autoCopy: input.clipboard === true ? prefs.autoCopy : false,
    noClipboard: input.clipboard !== true,
    print: false,
  })

  return {
    ...out,
    sheetTime: normalizeSheetTime(plan.sheetTime),
    gather: {
      repos: gather.repos.length,
      commitCount: gather.commitCount,
      sessionHours: gather.sessionHours,
    },
    dailyText: out.dailyText || formatDaily(plan),
  }
}
