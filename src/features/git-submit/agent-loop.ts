/**
 * git-submit agent 工作流：通用 `runLoop` + 本领域 pull / leftover / push。
 */
import chalk from 'chalk'
import { runLoop } from '@/agent'
import { listPendingPaths } from './collect'
import { GitSubmitError } from './errors'
import { stepPull, stepPush } from './git'
import { createContext, runOnce } from './run'
import type { GitSubmitContext, GitSubmitOptions } from './types'

export const AGENT_GC_MAX_ROUNDS = 5

export type AgentGcOptions = GitSubmitOptions & {
  maxRounds?: number
}

function logLeftover(paths: string[], round: number, maxRounds: number): void {
  if (round < maxRounds) {
    console.log(
      chalk.yellow(`⚠ 仍有 ${paths.length} 个文件，agent 继续 ${round + 1}/${maxRounds}`),
    )
  } else {
    console.log(chalk.yellow(`agent 已达 ${maxRounds} 轮上限，仍有残留`))
  }
  for (const p of paths.slice(0, 12)) console.log(chalk.dim(`  · ${p}`))
  if (paths.length > 12) console.log(chalk.dim(`  · … +${paths.length - 12}`))
}

async function maybePush(
  ctx: GitSubmitContext,
  options: AgentGcOptions,
  hashes: string[],
): Promise<GitSubmitContext> {
  if (options.noPush || options.dryRun || hashes.length === 0) return ctx
  return stepPush({ ...ctx, commitHashes: hashes })
}

/** 残留 / 失败最多再跑 maxRounds 轮（`tkt agent gc`） */
export async function runAgentGc(options: AgentGcOptions = {}): Promise<GitSubmitContext> {
  const maxRounds = options.maxRounds ?? AGENT_GC_MAX_ROUNDS
  const quiet = Boolean(options.json)

  let seed = await createContext(options)
  if (!options.noPull) seed = await stepPull(seed)

  const allHashes: string[] = []
  const allCommits: NonNullable<GitSubmitContext['commitPlan']>['commits'] = []
  let cursor = seed
  let leftover: string[] = []

  try {
    const last = await runLoop<GitSubmitContext>({
      max: maxRounds,
      label: 'gc',
      quiet,
      run: async (round) => {
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

        leftover = out.leftover ?? (await listPendingPaths(out.cwd))
        cursor = {
          ...out,
          noHistory: false,
          commitHashes: allHashes,
          commitPlan: allCommits.length ? { commits: allCommits } : out.commitPlan,
          leftover,
        }
        return cursor
      },
      done: async (out, round) => {
        if (options.dryRun) return true
        const left = out.leftover ?? []
        if (left.length === 0) return true
        if (!quiet) logLeftover(left, round, maxRounds)
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

    const ctx: GitSubmitContext = {
      ...(last ?? cursor),
      commitHashes: allHashes,
      commitPlan: allCommits.length ? { commits: allCommits } : (last ?? cursor).commitPlan,
      leftover,
    }
    return await maybePush(ctx, options, allHashes)
  } catch (e) {
    // 已有落盘 commit：尽量先 push 再抛
    if (allHashes.length > 0) {
      try {
        await maybePush(cursor, options, allHashes)
      } catch {
        /* 仍抛原错 */
      }
    }
    throw e
  }
}
