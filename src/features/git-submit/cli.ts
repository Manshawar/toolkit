/** CLI 结果输出：`tkt gc` / `tkt agent gc` 共用 */
import chalk from 'chalk'
import { emitCliError, emitJson, GitSubmitResultSchema } from '@/core/cli'
import { GitSubmitError } from './errors'
import type { GitSubmitContext, GitSubmitOptions } from './types'

export function logLeftoverPaths(paths: string[], prefix = '  '): void {
  if (!paths.length) return
  console.log(chalk.yellow(`${prefix}⚠ 仍有 ${paths.length} 个文件未纳入本次 plan`))
  for (const p of paths.slice(0, 12)) console.log(chalk.dim(`${prefix}  · ${p}`))
  if (paths.length > 12) console.log(chalk.dim(`${prefix}  · … +${paths.length - 12}`))
}

/** 统一打印 / JSON / CLEAN / 错误；label 区分 gc vs agent */
export function emitGcOutcome(
  ctx: GitSubmitContext,
  options: Pick<GitSubmitOptions, 'json' | 'dryRun'>,
  label: 'gc' | 'agent' = 'gc',
): void {
  const commits = (ctx.commitPlan?.commits ?? []).map((c, i) => ({
    message: c.message,
    hash: ctx.commitHashes?.[i] ?? '',
  }))
  const pushed = Boolean(ctx.pushed)
  const left = ctx.leftover?.length ?? 0

  if (options.json) {
    emitJson(GitSubmitResultSchema, {
      ok: true as const,
      commits,
      pushed,
      gerrit: ctx.isGerrit,
    })
    return
  }

  if (options.dryRun) {
    console.log(chalk.yellow('dry-run 完成'))
    return
  }

  const pushBit = pushed ? (ctx.isGerrit ? ' + gerrit + push' : ' + push') : ''
  const head = label === 'agent' ? 'agent 完成' : '完成'
  console.log(chalk.green(`${head}：${commits.length} 个 commit${pushBit}`))
  if (left) logLeftoverPaths(ctx.leftover!, '')
}

export function emitGcError(
  e: unknown,
  options: Pick<GitSubmitOptions, 'json'>,
  fallbackCode = 'GIT_SUBMIT',
): void {
  if (e instanceof GitSubmitError && e.code === 'CLEAN') {
    if (options.json) emitCliError({ ok: false, code: 'CLEAN', message: e.message })
    else console.log(chalk.dim(e.message))
    return
  }
  const msg = e instanceof Error ? e.message : String(e)
  const code = e instanceof GitSubmitError ? e.code : fallbackCode
  if (options.json) emitCliError({ ok: false, code, message: msg })
  else console.error(chalk.red(msg))
  process.exitCode = 1
}
