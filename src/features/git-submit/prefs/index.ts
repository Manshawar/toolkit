/**
 * gc 自动推送偏好：只问一次，写入 package `.env` 的 TKT_GC_PUSH。
 * 之后直接用；可用 --push / --no-push 覆盖并改写偏好。
 */
import * as fs from 'fs'
import { config as loadDotenv } from 'dotenv'
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { packageRoot } from '@/core/paths'
import * as path from 'path'

export const GC_PUSH_ENV_KEY = 'TKT_GC_PUSH' as const

function envPath(): string {
  return path.join(packageRoot(), '.env')
}

function reloadEnv(): void {
  loadDotenv({ path: envPath(), quiet: true, override: true })
}

function parseBool(raw: string | undefined): boolean | null {
  if (raw == null || raw === '') return null
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return null
}

function upsertEnvKey(file: string, key: string, value: string): void {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : []
  let found = false
  const next = lines.map((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return line
    const i = t.indexOf('=')
    if (i <= 0) return line
    if (t.slice(0, i).trim() !== key) return line
    found = true
    return `${key}=${value}`
  })
  if (!found) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    next.push('# tkt gc')
    next.push(`${key}=${value}`)
    next.push('')
  }
  fs.writeFileSync(file, next.join('\n'), 'utf8')
}

/** 读取已保存偏好；未设置返回 null */
export function readAutoPushPref(): boolean | null {
  reloadEnv()
  return parseBool(process.env[GC_PUSH_ENV_KEY])
}

/** 写入偏好并同步 process.env */
export function saveAutoPushPref(enable: boolean): void {
  const file = envPath()
  upsertEnvKey(file, GC_PUSH_ENV_KEY, enable ? 'true' : 'false')
  process.env[GC_PUSH_ENV_KEY] = enable ? 'true' : 'false'
}

async function askOnce(): Promise<boolean> {
  if (!process.stdin.isTTY) return false

  const choice = await p.select({
    message: '是否默认开启自动推送？（只问一次，将写入 .env）',
    options: [
      { value: false, label: 'No', hint: '只 commit' },
      { value: true, label: 'Yes', hint: 'commit 后 push' },
    ],
    initialValue: false,
  })

  if (p.isCancel(choice)) {
    p.cancel('已取消')
    process.exit(0)
  }
  return choice
}

/** 打印当前偏好与修改方式 */
export function printAutoPushStatus(enable: boolean): void {
  const on = chalk.green('on')
  const off = chalk.yellow('off')
  console.log(
    chalk.dim(
      `auto-push: ${enable ? on : off}  ·  改: tkt gc --push | --no-push  或 .env ${GC_PUSH_ENV_KEY}=true|false`,
    ),
  )
}

/**
 * 解析是否跳过 push（noPush）。
 * - CLI --push / --no-push：本次生效并写回偏好
 * - 已有 TKT_GC_PUSH：直接用
 * - 皆无：问一次并保存
 */
export async function resolveAutoPush(opts: {
  push?: boolean
  noPush?: boolean
  json?: boolean
  dryRun?: boolean
}): Promise<{ noPush: boolean; enable: boolean }> {
  // 显式 flag：覆盖并记住
  if (opts.push) {
    saveAutoPushPref(true)
    return { noPush: false, enable: true }
  }
  if (opts.noPush) {
    saveAutoPushPref(false)
    return { noPush: true, enable: false }
  }

  const saved = readAutoPushPref()
  if (saved != null) {
    return { noPush: !saved, enable: saved }
  }

  // json / dry-run / 非 TTY：默认不推送，但不强行写入（避免污染）
  if (opts.json || opts.dryRun || !process.stdin.isTTY) {
    return { noPush: true, enable: false }
  }

  const enable = await askOnce()
  saveAutoPushPref(enable)
  return { noPush: !enable, enable }
}
