/**
 * AI 配置拦截器 + 重配命令。
 * - 调用前缺 URL/Key/Model → 挂起填写
 * - `tkt config` → 重新填写；有值覆盖，空回车保留原值
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { config as loadDotenv } from 'dotenv'
import * as p from '@clack/prompts'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const AI_KEYS = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'] as const

let cached: AiConfig | null = null
/** 并发调用共用一次交互，避免重复提问 */
let inflight: Promise<AiConfig> | null = null

function packageRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  for (const root of [path.resolve(dir, '..'), path.resolve(dir, '../..')]) {
    if (fs.existsSync(path.join(root, 'package.json'))) return root
  }
  return path.resolve(dir, '..')
}

export function aiEnvPath(): string {
  return path.join(packageRoot(), '.env')
}

function quoteEnv(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return v
}

function reloadEnv(): void {
  loadDotenv({ path: aiEnvPath(), quiet: true, override: true })
}

function readFromEnv(): Partial<AiConfig> {
  reloadEnv()
  return {
    baseUrl: process.env.AI_BASE_URL?.trim() || undefined,
    apiKey: process.env.AI_API_KEY?.trim() || undefined,
    model: process.env.AI_MODEL?.trim() || undefined,
  }
}

function missingKeys(partial: Partial<AiConfig>): string[] {
  return [
    !partial.baseUrl && 'AI_BASE_URL',
    !partial.apiKey && 'AI_API_KEY',
    !partial.model && 'AI_MODEL',
  ].filter((k): k is string => Boolean(k))
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

function upsertAiKeys(file: string, values: Record<(typeof AI_KEYS)[number], string>): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  const used = new Set<string>()
  const next = lines.map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const i = t.indexOf('=')
    if (i <= 0) return line
    const k = t.slice(0, i).trim()
    if ((AI_KEYS as readonly string[]).includes(k)) {
      used.add(k)
      return `${k}=${quoteEnv(values[k as (typeof AI_KEYS)[number]])}`
    }
    return line
  })
  const missing = AI_KEYS.filter((k) => !used.has(k))
  if (missing.length) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push('# tkt AI（OpenAI Compatible）')
    for (const k of missing) next.push(`${k}=${quoteEnv(values[k])}`)
    next.push('')
  }
  fs.writeFileSync(file, next.join('\n'), 'utf8')
}

function applyEnv(config: AiConfig): void {
  Object.assign(process.env, {
    AI_BASE_URL: config.baseUrl,
    AI_API_KEY: config.apiKey,
    AI_MODEL: config.model,
  })
}

function persist(config: AiConfig): void {
  const file = aiEnvPath()
  upsertAiKeys(file, {
    AI_BASE_URL: config.baseUrl,
    AI_API_KEY: config.apiKey,
    AI_MODEL: config.model,
  })
  applyEnv(config)
  cached = config
}

function abortIfCancel(value: unknown): asserts value is string {
  if (p.isCancel(value)) {
    p.cancel('已取消')
    process.exit(0)
  }
}

/**
 * 交互填写三项。
 * - keepExisting：空回车保留原值（`tkt config`）
 * - 首次缺失：空回车无效，必须填
 */
async function promptAiFields(
  partial: Partial<AiConfig>,
  opts: { keepExisting: boolean; title: string },
): Promise<AiConfig> {
  if (!process.stdin.isTTY) {
    throw new Error(`需要交互终端，或手动写入 ${aiEnvPath()}`)
  }

  p.intro(opts.title)

  const url = await p.text({
    message: 'AI Base URL',
    placeholder: partial.baseUrl ?? 'https://…/v1',
    defaultValue: opts.keepExisting ? partial.baseUrl : undefined,
    validate: (v) => {
      const raw = (v ?? '').trim()
      const next = raw || (opts.keepExisting ? partial.baseUrl : '') || ''
      if (!next) return '不能为空'
      return undefined
    },
  })
  abortIfCancel(url)

  const key = await p.text({
    message: 'AI API Key',
    placeholder: partial.apiKey ? maskSecret(partial.apiKey) : 'sk-…',
    defaultValue: opts.keepExisting ? partial.apiKey : undefined,
    validate: (v) => {
      const raw = (v ?? '').trim()
      const next = raw || (opts.keepExisting ? partial.apiKey : '') || ''
      if (!next) return '不能为空'
      return undefined
    },
  })
  abortIfCancel(key)

  const model = await p.text({
    message: 'AI Model',
    placeholder: partial.model ?? 'model-id',
    defaultValue: opts.keepExisting ? partial.model : undefined,
    validate: (v) => {
      const raw = (v ?? '').trim()
      const next = raw || (opts.keepExisting ? partial.model : '') || ''
      if (!next) return '不能为空'
      return undefined
    },
  })
  abortIfCancel(model)

  const config: AiConfig = {
    baseUrl: (url.trim() || partial.baseUrl || '').replace(/\/+$/, ''),
    apiKey: key.trim() || partial.apiKey || '',
    model: model.trim() || partial.model || '',
  }

  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new Error('AI 配置项不能为空')
  }

  persist(config)
  p.outro(`已保存 → ${aiEnvPath()}`)
  return config
}

async function promptMissing(partial: Partial<AiConfig>): Promise<AiConfig> {
  const miss = missingKeys(partial)
  return promptAiFields(partial, {
    keepExisting: false,
    title: `缺少 AI 配置（${miss.join(', ')}）`,
  })
}

/**
 * `tkt config`：重新填写。有输入则改，空回车保留原值。
 * 若某项原本没有，则该项必须填写。
 */
export async function reconfigureAiConfig(): Promise<AiConfig> {
  resetAiConfigCache()
  const partial = readFromEnv()
  return promptAiFields(partial, {
    keepExisting: true,
    title: '重新配置 AI（空回车保留原值）',
  })
}

/** 打印当前配置（Key 脱敏） */
export function showAiConfig(): void {
  const partial = readFromEnv()
  const file = aiEnvPath()
  console.log(`env: ${file}`)
  console.log(`AI_BASE_URL=${partial.baseUrl ?? '(未设置)'}`)
  console.log(`AI_API_KEY=${partial.apiKey ? maskSecret(partial.apiKey) : '(未设置)'}`)
  console.log(`AI_MODEL=${partial.model ?? '(未设置)'}`)
}

/**
 * 拦截器：调用 AI 前确保 URL / Key / Model 齐全。
 */
export async function interceptAiConfig(): Promise<AiConfig> {
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    const partial = readFromEnv()
    if (partial.baseUrl && partial.apiKey && partial.model) {
      const config: AiConfig = {
        baseUrl: partial.baseUrl.replace(/\/$/, ''),
        apiKey: partial.apiKey,
        model: partial.model,
      }
      cached = config
      return config
    }
    return promptMissing(partial)
  })()

  try {
    return await inflight
  } finally {
    inflight = null
  }
}

export async function ensureAiConfig(): Promise<AiConfig> {
  return interceptAiConfig()
}

export function resetAiConfigCache(): void {
  cached = null
  inflight = null
}
