/**
 * AI backend 解析。
 *
 * 优先级：`TKT_AI_BACKEND` 环境变量 > 持久化 `AI_BACKEND`（~/.config/tkt/ai/.env）> auto。
 * auto：本机有 `claude` CLI → Claude Code（复用其登录态 / 第三方网关配置，零配置）；
 * 否则回退自有 OpenAI Compatible（AI_BASE_URL / AI_API_KEY / AI_MODEL）。
 */
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { ensureDataDir } from '@/core/paths'

export type AiBackend = 'claude' | 'openai'

/** backend 生效来源：env 强制 / 持久化配置 / auto 探测 */
export type AiBackendSource = 'env' | 'config' | 'auto'

let cliDetected: boolean | null = null

/** 本机 claude CLI 是否可用（一次进程只探一次） */
export function hasClaudeCli(): boolean {
  if (cliDetected !== null) return cliDetected
  try {
    const r = spawnSync('claude', ['--version'], { stdio: 'ignore', timeout: 8000 })
    cliDetected = r.status === 0
  } catch {
    cliDetected = false
  }
  return cliDetected
}

/** TKT_AI_BACKEND 环境变量强制值；未设 / 非法 → null */
export function envAiBackend(): AiBackend | null {
  const env = process.env.TKT_AI_BACKEND?.trim().toLowerCase()
  return env === 'claude' || env === 'openai' ? env : null
}

/** 持久化 AI_BACKEND（~/.config/tkt/ai/.env）。每次读文件，UI 保存后同进程即生效 */
export function persistedAiBackend(): AiBackend | null {
  try {
    const file = path.join(ensureDataDir('ai'), '.env')
    const m = fs.readFileSync(file, 'utf8').match(/^\s*AI_BACKEND=["']?([\w-]+)["']?\s*$/m)
    const v = m?.[1]?.trim().toLowerCase()
    return v === 'claude' || v === 'openai' ? v : null
  } catch {
    return null
  }
}

/** env > 持久化；皆无 → null（auto） */
export function forcedAiBackend(): AiBackend | null {
  return envAiBackend() ?? persistedAiBackend()
}

export function aiBackendSource(): AiBackendSource {
  if (envAiBackend()) return 'env'
  if (persistedAiBackend()) return 'config'
  return 'auto'
}

export function resolveAiBackend(): AiBackend {
  return forcedAiBackend() ?? (hasClaudeCli() ? 'claude' : 'openai')
}

let hinted = false

/** 告知当前 backend。走 stderr，不污染 --json 的 stdout；一次进程只提示一次 */
export function hintAiBackend(backend: AiBackend, detail?: string): void {
  if (hinted) return
  hinted = true
  const text =
    backend === 'claude'
      ? 'Claude Code（本机 claude CLI；TKT_AI_BACKEND=openai 切自有配置）'
      : `OpenAI Compatible${detail ? `（${detail}）` : ''}（TKT_AI_BACKEND=claude 切 Claude Code）`
  console.error(chalk.dim(`→ AI: ${text}`))
}

/** 测试 / 重配后重置 */
export function resetAiBackendCache(): void {
  cliDetected = null
  hinted = false
}
