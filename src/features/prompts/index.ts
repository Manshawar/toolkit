/**
 * Prompt 目录：`prompts/<path>.md` ↔ task id。
 * 本地 CLI（如 tkt gc）从这里加载 system / tool 元数据。
 */
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import { emitCliError, emitJson, PromptListSchema, PromptShowSchema } from '../../core/cli'

export const PROMPT_CATALOG = {
  'git-submit.commit-plan': 'git-submit/commit-plan.md',
  'git-submit.deep-inspect-diff': 'git-submit/deep-inspect-diff.tool.json',
  'report.daily': 'report/daily.md',
} as const

export type PromptId = keyof typeof PROMPT_CATALOG

export function promptsRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  // bundled: lib/index.js → ../prompts；源码: src/features/prompts → ../../../prompts
  for (const p of [
    path.resolve(dir, '../prompts'),
    path.resolve(dir, '../../../prompts'),
    path.resolve(process.cwd(), 'prompts'),
  ]) {
    if (fs.existsSync(p)) return p
  }
  return path.resolve(dir, '../prompts')
}

export function resolvePromptPath(id: string): string {
  const rel = PROMPT_CATALOG[id as PromptId]
  if (!rel) throw new Error(`未知 prompt id: ${id}（tkt prompt list）`)
  return path.join(promptsRoot(), rel)
}

export function loadPrompt(id: string): string {
  const file = resolvePromptPath(id)
  if (!fs.existsSync(file)) throw new Error(`prompt 不存在: ${file}`)
  return stripFrontmatter(fs.readFileSync(file, 'utf8')).trim()
}

/** 加载 JSON 类 prompt（如 tool 元数据） */
export function loadPromptJson<T = unknown>(id: string): T {
  return JSON.parse(loadPrompt(id)) as T
}

export function listPrompts(): Array<{ id: string; file: string }> {
  return Object.entries(PROMPT_CATALOG).map(([id, file]) => ({ id, file }))
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return raw
  return raw.slice(end + 4).replace(/^\r?\n/, '')
}

export function runPromptList(opts: { json?: boolean } = {}): void {
  const prompts = listPrompts()
  if (opts.json) {
    emitJson(PromptListSchema, { ok: true as const, prompts })
    return
  }
  for (const p of prompts) console.log(`${p.id}\t${p.file}`)
}

export function runPromptShow(id: string, opts: { json?: boolean } = {}): void {
  if (!id) {
    if (opts.json) emitCliError({ ok: false, code: 'USAGE', message: 'tkt prompt show <id>' })
    else console.error('用法: tkt prompt show <id>')
    process.exitCode = 1
    return
  }
  try {
    const text = loadPrompt(id)
    const p = resolvePromptPath(id)
    if (opts.json) {
      emitJson(PromptShowSchema, { ok: true as const, id, path: p, text })
      return
    }
    console.error(chalk.dim(p))
    console.log(text)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (opts.json) emitCliError({ ok: false, code: 'PROMPT', message })
    else console.error(message)
    process.exitCode = 1
  }
}
