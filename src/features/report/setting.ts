/**
 * 日报配置：~/.config/tkt/report/setting.json
 * 归档：~/.config/tkt/report/history/YYYY-MM-DD.md
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { dataDir, ensureDataDir } from '../../core/paths'
import { DEFAULT_SETTING, REPORT_ARG, type ReportSetting } from './types'

export function reportDir(): string {
  return dataDir(REPORT_ARG)
}

export function settingPath(): string {
  return path.join(reportDir(), 'setting.json')
}

export function historyDir(): string {
  return path.join(reportDir(), 'history')
}

export function ensureReportDir(): string {
  return ensureDataDir(REPORT_ARG)
}

export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

export function readSetting(): ReportSetting | null {
  const p = settingPath()
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ReportSetting
}

export function writeSetting(data: ReportSetting): void {
  ensureReportDir()
  fs.writeFileSync(settingPath(), JSON.stringify(data, null, 2), 'utf8')
}

/** 旧路径 → ~/.config/tkt/report（仅新位置尚无 setting 时） */
export function migrateLegacyMemory(): void {
  if (fs.existsSync(settingPath())) return

  const candidates = [
    path.join(os.homedir(), '.daily-report', 'setting.json'),
    path.join(os.homedir(), '.claude', '.daily-report', 'setting.json'),
  ]

  for (const legacy of candidates) {
    if (!fs.existsSync(legacy)) continue
    ensureReportDir()
    fs.copyFileSync(legacy, settingPath())
    const histSrc = path.join(path.dirname(legacy), 'history')
    if (fs.existsSync(histSrc)) {
      fs.mkdirSync(historyDir(), { recursive: true })
      for (const f of fs.readdirSync(histSrc)) {
        const from = path.join(histSrc, f)
        const to = path.join(historyDir(), f)
        if (fs.statSync(from).isFile() && !fs.existsSync(to)) {
          fs.copyFileSync(from, to)
        }
      }
    }
    console.error(`✅ 已迁移记忆: ${legacy} → ${settingPath()}`)
    return
  }
}

export function ensureSetting(partial?: Partial<ReportSetting>): ReportSetting {
  ensureReportDir()
  migrateLegacyMemory()
  if (!fs.existsSync(settingPath())) {
    writeSetting({ ...DEFAULT_SETTING, ...partial })
  }
  let setting = readSetting()!
  let dirty = false
  if (!setting.day_start_max) {
    setting.day_start_max = DEFAULT_SETTING.day_start_max
    dirty = true
  }
  if (!setting.day_end_min) {
    setting.day_end_min = DEFAULT_SETTING.day_end_min
    dirty = true
  }
  if (!setting.role_definitions) {
    setting.role_definitions = DEFAULT_SETTING.role_definitions
    dirty = true
  }
  if (!Array.isArray(setting.repositories)) {
    setting.repositories = []
    dirty = true
  }
  setting.node_available = true
  if (dirty) writeSetting(setting)
  return setting
}
