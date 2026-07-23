/** ~/.config/tkt/report/setting.json + history/ */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dataDir, ensureDataDir } from '../../../core/paths'
import { DEFAULT_SETTING, REPORT_ARG, type ReportSetting, type RepoEntry } from '../types'

export function reportDir(): string {
  return dataDir(REPORT_ARG)
}

export function settingPath(): string {
  return path.join(reportDir(), 'setting.json')
}

export function historyDir(): string {
  return path.join(reportDir(), 'history')
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

export function readSetting(): ReportSetting | null {
  try {
    return JSON.parse(fs.readFileSync(settingPath(), 'utf8')) as ReportSetting
  } catch {
    return null
  }
}

export function writeSetting(data: ReportSetting): void {
  ensureDataDir(REPORT_ARG)
  fs.writeFileSync(settingPath(), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function migrateLegacy(): void {
  if (fs.existsSync(settingPath())) return
  for (const legacy of [
    path.join(os.homedir(), '.daily-report', 'setting.json'),
    path.join(os.homedir(), '.claude', '.daily-report', 'setting.json'),
  ]) {
    if (!fs.existsSync(legacy)) continue
    ensureDataDir(REPORT_ARG)
    fs.copyFileSync(legacy, settingPath())
    console.error(`✅ 已迁移配置: ${legacy}`)
    return
  }
}

/** 把名单勾选 / 日报名写回 */
export function applyRoster(
  rows: Array<{
    path: string
    display_name: string
    enabled: boolean
    name_custom?: boolean
  }>,
): RepoEntry[] {
  const setting = loadSetting()
  for (const row of rows) {
    const i = setting.repositories.findIndex((r) => r.path === row.path)
    if (i < 0) continue
    setting.repositories[i]!.display_name = row.display_name.trim()
    setting.repositories[i]!.enabled = row.enabled
    if (typeof row.name_custom === 'boolean') {
      setting.repositories[i]!.name_custom = row.name_custom
    }
    setting.repositories[i]!.last_used_at = isoNow()
  }
  writeSetting(setting)
  return setting.repositories
}

export function setShowRoster(on: boolean): void {
  const setting = loadSetting()
  setting.show_roster = on
  writeSetting(setting)
}

export function loadSetting(): ReportSetting {
  migrateLegacy()
  ensureDataDir(REPORT_ARG)
  let s = readSetting()
  if (!s) {
    s = { ...DEFAULT_SETTING, repositories: [] }
    writeSetting(s)
    return s
  }
  if (!s.day_start_max) s.day_start_max = DEFAULT_SETTING.day_start_max
  if (!s.day_end_min) s.day_end_min = DEFAULT_SETTING.day_end_min
  // 旧默认 20:30 容易把一天拉太长 → 迁到 21:00（封顶仍 22:00）
  if (s.day_end_min === '20:30') s.day_end_min = '21:00'
  if (s.day_start_max === '09:30') s.day_start_max = '09:00'
  if (!s.role_definitions) s.role_definitions = DEFAULT_SETTING.role_definitions
  if (typeof s.show_roster !== 'boolean') s.show_roster = true
  if (s.auto_copy == null) s.auto_copy = true
  if (!Array.isArray(s.repositories)) s.repositories = []
  for (const r of s.repositories) {
    if (typeof r.enabled !== 'boolean') {
      r.enabled = !/github\.com/i.test(r.git_remote || '')
    }
    if (r.display_name == null) r.display_name = ''
    if (r.git_remote == null) r.git_remote = ''
  }
  return s
}
