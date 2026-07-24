/**
 * 工作流级通用 loop（SDK 不提供）。
 * Tool 步进用 `stopWhen` / `ToolLoopAgent`；领域「再跑一轮」用本函数。
 */
import chalk from 'chalk'

/**
 * 最多 max 次执行 body，until 为 true 则停。
 * 失败是否继续由 onError 决定（抛出则中断）。
 */
export async function agentLoop<T>(opts: {
  max: number
  label?: string
  quiet?: boolean
  body: (round: number) => Promise<T>
  until: (result: T, round: number) => boolean | Promise<boolean>
  onError?: (err: unknown, round: number) => 'retry' | 'throw' | 'stop'
}): Promise<T | undefined> {
  const { max, label = 'agent', quiet, body, until, onError } = opts
  let last: T | undefined

  for (let round = 1; round <= max; round++) {
    if (round > 1 && !quiet) console.log(chalk.dim(`→ ${label} loop ${round}/${max}`))
    try {
      last = await body(round)
      if (await until(last, round)) return last
      if (round >= max) return last
    } catch (e) {
      const action = onError?.(e, round) ?? 'throw'
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
