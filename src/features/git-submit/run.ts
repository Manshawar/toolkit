/** 编排：pull →（diff → analyze → commit）×≤5 → push */
import chalk from 'chalk'
import { createGit, currentBranch, ensureRepo, hasCommits, listRemotes } from '@/core/git'
import { stepAnalyze } from './ai'
import { stepConflict, stepDiff, stepHistory } from './collect'
import { GitSubmitError } from './errors'
import { stepCommit, stepPull, stepPush } from './git'
import type { GitSubmitContext, GitSubmitOptions, Step } from './types'

/** 残留或失败时自动再跑，避免 AI 漏文件 */
const MAX_ROUNDS = 5

export async function createContext(options: GitSubmitOptions): Promise<GitSubmitContext> {
  const cwd = options.cwd ?? process.cwd()
  const git = createGit(cwd)
  const repo = await ensureRepo(git)
  const branch = await currentBranch(git)
  const remotes = await listRemotes(git)
  const noHistory = !(await hasCommits(git))
  return {
    cwd: repo,
    repo,
    branch,
    options,
    isGerrit: remotes.some((r) => r.isGerrit),
    noHistory,
  }
}

async function runSteps(ctx: GitSubmitContext, steps: Step[]): Promise<GitSubmitContext> {
  let cur = ctx
  for (const step of steps) cur = await step(cur)
  return cur
}

export async function runWorkflow(options: GitSubmitOptions): Promise<GitSubmitContext> {
  try {
    let ctx = await createContext(options)
    if (!options.noPull) ctx = await stepPull(ctx)

    const allHashes: string[] = []
    const allMessages: NonNullable<GitSubmitContext['commitPlan']>['commits'] = []
    let last: GitSubmitContext = ctx

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      if (round > 1 && !options.json) {
        console.log(chalk.dim(`→ round ${round}/${MAX_ROUNDS}`))
      }

      try {
        last = await runSteps(ctx, [
          stepConflict,
          stepDiff,
          stepHistory,
          stepAnalyze,
          stepCommit,
        ])

        if (last.commitHashes?.length) allHashes.push(...last.commitHashes)
        if (last.commitPlan?.commits.length) allMessages.push(...last.commitPlan.commits)

        const leftover = last.leftover ?? []
        if (leftover.length === 0 || options.dryRun) {
          ctx = last
          break
        }

        if (!options.json) {
          console.log(
            chalk.yellow(
              `⚠ 仍有 ${leftover.length} 个文件未纳入，继续第 ${Math.min(round + 1, MAX_ROUNDS)}/${MAX_ROUNDS} 轮`,
            ),
          )
          for (const p of leftover.slice(0, 12)) console.log(chalk.dim(`  · ${p}`))
          if (leftover.length > 12) console.log(chalk.dim(`  · … +${leftover.length - 12}`))
        }

        if (round >= MAX_ROUNDS) {
          if (!options.json) {
            console.log(chalk.yellow(`已达 ${MAX_ROUNDS} 轮上限，仍有残留，可再跑 tkt gc`))
          }
          ctx = last
          break
        }

        // 下一轮重新采集；noHistory 仅首轮有意义
        ctx = {
          ...last,
          noHistory: false,
          diff: undefined,
          style: undefined,
          commitPlan: undefined,
          commitHashes: undefined,
          leftover: undefined,
        }
      } catch (e) {
        if (e instanceof GitSubmitError && e.code === 'CLEAN') {
          // 首轮干净：原样抛出；后续轮已提交完 → 成功结束
          if (allHashes.length === 0 && round === 1) throw e
          break
        }
        if (e instanceof GitSubmitError && e.code === 'CONFLICT') throw e

        const msg = e instanceof Error ? e.message : String(e)
        if (round >= MAX_ROUNDS) throw e

        if (!options.json) {
          console.log(chalk.yellow(`⚠ 失败，重试 ${round + 1}/${MAX_ROUNDS}：${msg}`))
        }
        ctx = {
          ...ctx,
          noHistory: false,
          diff: undefined,
          style: undefined,
          commitPlan: undefined,
          commitHashes: undefined,
          leftover: undefined,
        }
      }
    }

    ctx = {
      ...last,
      ...ctx,
      commitHashes: allHashes,
      commitPlan: allMessages.length ? { commits: allMessages } : last.commitPlan,
    }

    if (!options.noPush && allHashes.length > 0 && !options.dryRun) {
      ctx = await stepPush(ctx)
    }

    return ctx
  } catch (e) {
    if (e instanceof GitSubmitError) throw e
    throw new GitSubmitError(e instanceof Error ? e.message : String(e))
  }
}
