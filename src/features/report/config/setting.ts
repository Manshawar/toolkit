/** ~/.config/tkt/report/setting.json + history/ */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dataDir, ensureDataDir } from '../../../core/paths'
import { DEFAULT_SETTING, REPORT_ARG, type ReportSetting } from '../types'

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
  if (!s.role_definitions) s.role_definitions = DEFAULT_SETTING.role_definitions
  if (!Array.isArray(s.repositories)) s.repositories = []
  return s
}
