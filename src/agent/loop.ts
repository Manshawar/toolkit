/**
 * 通用工作流 loop（SDK 不提供）。
 *
 * - Tool 步进：用 `createAgentClient` + `stopWhen: stepCountIs`
 * - CLI / 领域「再跑直到完成」：用本文件 `runLoop`
 *
 * @example
 * ```ts
 * const last = await runLoop({
 *   max: 5,
 *   label: 'gc',
 *   run: (round) => doOneRound(round),
 *   done: (r) => r.leftover.length === 0,
 *   onError: (e, round) => (isRetryable(e) ? 'retry' : 'throw'),
 * })
 * ```
 */
import chalk from 'chalk'

export const DEFAULT_LOOP_MAX = 5

export type LoopErrorAction = 'retry' | 'throw' | 'stop'

export interface RunLoopOptions<T> {
  /** 最大轮次，默认 5 */
  max?: number
  /** 日志前缀，如 gc / report */
  label?: string
  quiet?: boolean
  /** 每一轮要做的事 */
  run: (round: number) => Promise<T>
  /** true = 工作完成，停止 */
  done: (result: T, round: number) => boolean | Promise<boolean>
  /**
   * 失败策略：
   * - retry：下一轮
   * - throw：抛出
   * - stop：静默结束，返回上一轮结果
   */
  onError?: (err: unknown, round: number) => LoopErrorAction
}

/**
 * 跑到 `done` 或达 `max`。
 * 供 `tkt agent *` / 各 feature 复用；领域细节（pull、push、leftover）留在 feature。
 */
export async function runLoop<T>(opts: RunLoopOptions<T>): Promise<T | undefined> {
  const max = opts.max ?? DEFAULT_LOOP_MAX
  const label = opts.label ?? 'agent'
  const quiet = Boolean(opts.quiet)
  let last: T | undefined

  for (let round = 1; round <= max; round++) {
    if (round > 1 && !quiet) {
      console.log(chalk.dim(`→ ${label} loop ${round}/${max}`))
    }

    try {
      last = await opts.run(round)
      if (await opts.done(last, round)) return last
      if (round >= max) return last
    } catch (e) {
      const action = opts.onError?.(e, round) ?? 'throw'
      if (action === 'stop') return last
      if (action === 'throw' || round >= max) throw e
      if (!quiet) {
        const msg = e instanceof Error ? e.message : String(e)
        console.log(chalk.yellow(`⚠ ${label} 失败，重试 ${round + 1}/${max}：${msg}`))
      }
    }
  }

  return last
}
