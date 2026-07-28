/**
 * Usage 偏好：默认 Token Plan provider + provider API Key。
 * - 默认 provider：~/.config/tkt/usage/prefs.json + usage/.env 的 TKT_PROVIDER
 *   （用户级 .env 覆盖包内 .env，保证 UI 设默认能赢过包内 TKT_PROVIDER）
 * - API Key：~/.config/tkt/usage/.env（UI 可填），读取时覆盖包内 .env
 */
import * as fs from 'fs'
import * as path from 'path'
import { config as loadDotenv } from 'dotenv'
import { dataDir, ensureDataDir } from '@/core/paths'

export interface UsagePrefs {
  defaultProvider?: string
}

function prefsPath(): string {
  return path.join(dataDir('usage'), 'prefs.json')
}

export function loadUsagePrefs(): UsagePrefs {
  try {
    const j = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Partial<UsagePrefs>
    return {
      defaultProvider: typeof j.defaultProvider === 'string' ? j.defaultProvider : undefined,
    }
  } catch {
    return {}
  }
}

export function saveDefaultProvider(id: string): UsagePrefs {
  const prefs: UsagePrefs = { ...loadUsagePrefs(), defaultProvider: id }
  fs.writeFileSync(
    path.join(ensureDataDir('usage'), 'prefs.json'),
    JSON.stringify(prefs, null, 2) + '\n',
    'utf8',
  )
  // 同步写用户级 .env：覆盖包内 TKT_PROVIDER，UI 设默认即生效
  saveUsageEnvKey('TKT_PROVIDER', id)
  return prefs
}

/* ---------------- provider API Key（用户级 .env） ---------------- */

export function usageEnvPath(): string {
  return path.join(ensureDataDir('usage'), '.env')
}

/** 读取 key 前调用：用户级覆盖包内 / shell 环境 */
export function reloadUsageEnv(): void {
  loadDotenv({ path: usageEnvPath(), quiet: true, override: true })
}

function quoteEnv(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return v
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

/** 单个 KEY=VALUE upsert 到用户级 .env，并同步 process.env */
export function saveUsageEnvKey(key: string, value: string): void {
  const file = usageEnvPath()
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  let hit = false
  const next = lines.map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const i = t.indexOf('=')
    if (i <= 0) return line
    if (t.slice(0, i).trim() === key) {
      hit = true
      return `${key}=${quoteEnv(value)}`
    }
    return line
  })
  if (!hit) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push(`${key}=${quoteEnv(value)}`, '')
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next.join('\n'), 'utf8')
  process.env[key] = value
}
