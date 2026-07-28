/**
 * bugrelay 配置：~/.config/tkt/bugrelay/setting.json
 * - addDirs: AI 分析时可读的源码目录（read_source 工具边界）
 * - redact / redactKeys: 快照脱敏开关与自定义脱敏键清单
 */
import * as fs from 'fs'
import * as path from 'path'
import { ensureDataDir } from '@/core/paths'

export interface BugrelaySettings {
  addDirs: string[]
  /** 快照回传前是否脱敏（token 类键只报键名） */
  redact: boolean
  /** 自定义脱敏键（大小写不敏感，子串匹配） */
  redactKeys: string[]
}

const DEFAULT_REDACT_KEYS = ['token', 'authorization', 'cookie', 'password', 'secret', 'ticket']

export function settingPath(): string {
  return path.join(ensureDataDir('bugrelay'), 'setting.json')
}

export function readSettings(): BugrelaySettings {
  const file = settingPath()
  let raw: Partial<BugrelaySettings> = {}
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BugrelaySettings>
  } catch {
    /* 首次使用无文件 */
  }
  return {
    addDirs: Array.isArray(raw.addDirs) ? raw.addDirs.filter((d) => typeof d === 'string') : [],
    redact: raw.redact !== false,
    redactKeys: Array.isArray(raw.redactKeys) ? raw.redactKeys : DEFAULT_REDACT_KEYS,
  }
}

export function saveSettings(patch: Partial<BugrelaySettings>): BugrelaySettings {
  const next = { ...readSettings(), ...patch }
  fs.writeFileSync(settingPath(), JSON.stringify(next, null, 2))
  return next
}

/** 追加源码目录（持久化去重），返回规范化后的绝对路径 */
export function addSourceDir(dir: string): { dir: string; settings: BugrelaySettings } {
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${abs}`)
  const settings = readSettings()
  if (!settings.addDirs.includes(abs)) {
    settings.addDirs.push(abs)
    saveSettings({ addDirs: settings.addDirs })
  }
  return { dir: abs, settings }
}
