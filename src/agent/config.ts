/**
 * AI 配置拦截器 + 重配命令。
 * - 缺 URL/Key/Model → 交互填写（不甩「环境变量」错误）
 * - 配置落盘：~/.config/tkt/ai/.env（全局安装也可用）；兼容读包内 .env
 * - `tkt config` → 重新填写
 */
import * as fs from 'fs'
import * as path from 'path'
import { config as loadDotenv } from 'dotenv'
import * as p from '@clack/prompts'
import { ensureDataDir, packageRoot } from '@/core/paths'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const AI_KEYS = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'] as const

let cached: AiConfig | null = null
/** 并发调用共用一次交互，避免重复提问 */
let inflight: Promise<AiConfig> | null = null

/** 用户级配置（优先）：~/.config/tkt/ai/.env */
export function aiEnvPath(): string {
  return path.join(ensureDataDir('ai'), '.env')
}

/** 包内 .env（兼容旧路径） */
function packageEnvPath(): string {
  return path.join(packageRoot(), '.env')
}

function quoteEnv(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return v
}

function reloadEnv(): void {
  // 先包内，再用户级覆盖
  const pkg = packageEnvPath()
  if (fs.existsSync(pkg)) {
    loadDotenv({ path: pkg, quiet: true, override: false })
  }
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
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
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
  upsertAiKeys(aiEnvPath(), {
    AI_BASE_URL: config.baseUrl,
    AI_API_KEY: config.apiKey,
    AI_MODEL: config.model,
  })
  applyEnv(config)
  cached = config
}

/** 名单 raw 模式后恢复，方便 clack 弹出填写 */
function prepareStdinForPrompt(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode?.(false)
      if (process.stdin.isPaused()) process.stdin.resume()
    }
  } catch {
    /* ignore */
  }
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
  prepareStdinForPrompt()

  if (!process.stdin.isTTY) {
    const miss = missingKeys(partial)
    throw new Error(
      `缺少 AI 配置（${miss.join(', ') || '未知'}）。请在 TTY 运行 \`tkt config\`，或写入 ${aiEnvPath()}`,
    )
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
    title: `缺少 AI 配置（${miss.join(', ')}），请先填写；完成后将继续`,
  })
}

/**
 * `tkt config`：重新填写。有输入则改，空回车保留原值。
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
  console.log(`env: ${aiEnvPath()}`)
  const pkg = packageEnvPath()
  if (fs.existsSync(pkg)) console.log(`also: ${pkg}（较低优先级）`)
  console.log(`AI_BASE_URL=${partial.baseUrl ?? '(未设置)'}`)
  console.log(`AI_API_KEY=${partial.apiKey ? maskSecret(partial.apiKey) : '(未设置)'}`)
  console.log(`AI_MODEL=${partial.model ?? '(未设置)'}`)
}

/** UI / API：查看配置（Key 脱敏） */
export function getAiConfigView(): {
  envPath: string
  packageEnv?: string
  baseUrl?: string
  apiKeyMasked?: string
  hasKey: boolean
  model?: string
} {
  const partial = readFromEnv()
  const pkg = packageEnvPath()
  return {
    envPath: aiEnvPath(),
    packageEnv: fs.existsSync(pkg) ? pkg : undefined,
    baseUrl: partial.baseUrl,
    apiKeyMasked: partial.apiKey ? maskSecret(partial.apiKey) : undefined,
    hasKey: Boolean(partial.apiKey),
    model: partial.model,
  }
}

/**
 * UI 保存：空 Key 保留原值；URL/Model 必填（可用原值兜底）。
 */
export function saveAiConfigFields(input: {
  baseUrl?: string
  apiKey?: string
  model?: string
}): AiConfig {
  const prev = readFromEnv()
  const baseUrl = (input.baseUrl ?? '').trim() || prev.baseUrl || ''
  const apiKey = (input.apiKey ?? '').trim() || prev.apiKey || ''
  const model = (input.model ?? '').trim() || prev.model || ''
  if (!baseUrl || !apiKey || !model) {
    throw new Error('AI Base URL / API Key / Model 均不能为空')
  }
  const config: AiConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
  }
  persist(config)
  return config
}

/**
 * 拦截器：调用 AI 前确保 URL / Key / Model 齐全；缺则跳转填写，不抛环境变量错误。
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
      applyEnv(config)
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

/** 鉴权 / 缺 key 类错误 → 应引导重配 */
export function isAiConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /api.?key|authorization|unauthor|401|403|invalid.?key|缺少环境变量|AI_API_KEY|AI_BASE_URL|AI_MODEL|Missing.*key|authentication/i.test(
    msg,
  )
}

/**
 * 鉴权失败时清缓存并引导重填，成功则返回新配置。
 * 非 TTY / 用户取消则抛出。
 */
export async function recoverAiConfig(err: unknown): Promise<AiConfig> {
  resetAiConfigCache()
  prepareStdinForPrompt()
  const partial = readFromEnv()
  const hint = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)
  return promptAiFields(partial, {
    keepExisting: true,
    title: `AI 配置无效，请重新填写（${hint}）`,
  })
}
