/** CLI 编排：pull → conflict → diff → history → analyze → commit → push（单次，不重试） */
import { createGit, currentBranch, ensureRepo, hasCommits, listRemotes } from '@/core/git'
import { stepAnalyze } from './ai'
import { stepConflict, stepDiff, stepHistory } from './collect'
import { GitSubmitError } from './errors'
import { stepCommit, stepPull, stepPush } from './git'
import type { GitSubmitContext, GitSubmitOptions, Step } from './types'

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

/** 单轮核心：conflict → diff → history → analyze → commit（供 CLI / agent 复用） */
export async function runOnce(ctx: GitSubmitContext): Promise<GitSubmitContext> {
  return runSteps(ctx, [stepConflict, stepDiff, stepHistory, stepAnalyze, stepCommit])
}

/** `tkt gc`：单次流水线，不做残留重试（重试在 agent loop） */
export async function runWorkflow(options: GitSubmitOptions): Promise<GitSubmitContext> {
  try {
    let ctx = await createContext(options)
    if (!options.noPull) ctx = await stepPull(ctx)
    ctx = await runOnce(ctx)
    if (!options.noPush && !options.dryRun && (ctx.commitHashes?.length ?? 0) > 0) {
      ctx = await stepPush(ctx)
    }
    return ctx
  } catch (e) {
    if (e instanceof GitSubmitError) throw e
    throw new GitSubmitError(e instanceof Error ? e.message : String(e))
  }
}
