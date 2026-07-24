/**
 * 工作流级 agent loop（SDK 不提供）。
 *
 * Vercel AI SDK 有 tool 步进 loop：`stopWhen` / `ToolLoopAgent` —— 只覆盖「一次对话里反复调 tool」。
 * 像 `tkt agent gc` 这种「commit 后还有残留 → 再采集再分析」是领域工作流，自己写。
 */
import chalk from 'chalk'
import { listPendingPaths } from '@/features/git-submit/collect'
import { GitSubmitError } from '@/features/git-submit/errors'
import { stepPull, stepPush } from '@/features/git-submit/git'
import {
  createContext,
  runOnce,
  type GitSubmitContext,
  type GitSubmitOptions,
} from '@/features/git-submit'

export const AGENT_MAX_ROUNDS = 5

export type AgentGcOptions = GitSubmitOptions & {
  /** 默认 5 */
  maxRounds?: number
}

/**
 * 通用：最多 max 次执行 body，until 为 true 则停。
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

/** gc 工作流 loop：残留 / 失败最多再跑 maxRounds 轮 */
export async function runAgentGc(options: AgentGcOptions = {}): Promise<GitSubmitContext> {
  const maxRounds = options.maxRounds ?? AGENT_MAX_ROUNDS
  let seed = await createContext(options)
  if (!options.noPull) seed = await stepPull(seed)

  const allHashes: string[] = []
  const allCommits: NonNullable<GitSubmitContext['commitPlan']>['commits'] = []
  let cursor = seed

  const last = await agentLoop<GitSubmitContext>({
    max: maxRounds,
    label: 'gc',
    quiet: Boolean(options.json),
    body: async (round) => {
      const out = await runOnce({
        ...cursor,
        options: { ...options, noPull: true, noPush: true },
        noHistory: round === 1 ? seed.noHistory : false,
        diff: undefined,
        style: undefined,
        commitPlan: undefined,
        commitHashes: undefined,
        leftover: undefined,
      })
      if (out.commitHashes?.length) allHashes.push(...out.commitHashes)
      if (out.commitPlan?.commits.length) allCommits.push(...out.commitPlan.commits)
      cursor = { ...out, noHistory: false }
      return out
    },
    until: async (out, round) => {
      if (options.dryRun) return true
      const leftover = out.leftover?.length
        ? out.leftover
        : await listPendingPaths(out.cwd)
      if (leftover.length === 0) return true
      if (!options.json && round < maxRounds) {
        console.log(
          chalk.yellow(
            `⚠ 仍有 ${leftover.length} 个文件，agent 继续 ${round + 1}/${maxRounds}`,
          ),
        )
        for (const p of leftover.slice(0, 12)) console.log(chalk.dim(`  · ${p}`))
      }
      if (round >= maxRounds && !options.json) {
        console.log(chalk.yellow(`agent 已达 ${maxRounds} 轮上限，仍有残留`))
      }
      return false
    },
    onError: (e, round) => {
      if (e instanceof GitSubmitError && e.code === 'CLEAN') {
        return allHashes.length === 0 && round === 1 ? 'throw' : 'stop'
      }
      if (e instanceof GitSubmitError && e.code === 'CONFLICT') return 'throw'
      return round >= maxRounds ? 'throw' : 'retry'
    },
  })

  if (!last && allHashes.length === 0) {
    throw new GitSubmitError('agent 未产生结果')
  }

  let ctx: GitSubmitContext = {
    ...(last ?? cursor),
    commitHashes: allHashes,
    commitPlan: allCommits.length
      ? { commits: allCommits }
      : (last ?? cursor).commitPlan,
    leftover: await listPendingPaths((last ?? cursor).cwd).catch(
      () => (last ?? cursor).leftover,
    ),
  }

  if (!options.noPush && !options.dryRun && allHashes.length > 0) {
    ctx = await stepPush(ctx)
  }

  return ctx
}
