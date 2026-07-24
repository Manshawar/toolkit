/**
 * git-submit 的 agent 工作流：在单次 `runOnce` 上循环，直到干净 / 达上限。
 * 通用 `agentLoop` 在 `@/agent`；本文件才碰 pull / leftover / commit 领域细节。
 */
import chalk from 'chalk'
import { agentLoop } from '@/agent'
import { listPendingPaths } from './collect'
import { GitSubmitError } from './errors'
import { stepPull, stepPush } from './git'
import { createContext, runOnce } from './run'
import type { GitSubmitContext, GitSubmitOptions } from './types'

export const AGENT_GC_MAX_ROUNDS = 5

export type AgentGcOptions = GitSubmitOptions & {
  /** 默认 5 */
  maxRounds?: number
}

/** 残留 / 失败最多再跑 maxRounds 轮（`tkt agent gc`） */
export async function runAgentGc(options: AgentGcOptions = {}): Promise<GitSubmitContext> {
  const maxRounds = options.maxRounds ?? AGENT_GC_MAX_ROUNDS
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
