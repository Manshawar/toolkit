/** 编排：pull → conflict → diff → history → analyze → commit → push */
import { createGit, currentBranch, ensureRepo, listRemotes } from '../../lib/git'
import { stepAnalyze } from './analyze'
import { stepConflict, stepDiff, stepHistory } from './collect'
import { stepCommit } from './commit'
import { GitSubmitError } from './errors'
import { stepPull, stepPush } from './sync'
import type { GitSubmitContext, GitSubmitOptions, Step } from './types'

export async function createContext(options: GitSubmitOptions): Promise<GitSubmitContext> {
  const cwd = options.cwd ?? process.cwd()
  const git = createGit(cwd)
  const repo = await ensureRepo(git)
  const branch = await currentBranch(git)
  const remotes = await listRemotes(git)
  return {
    cwd: repo,
    repo,
    branch,
    options,
    isGerrit: remotes.some((r) => r.isGerrit),
  }
}

async function runSteps(ctx: GitSubmitContext, steps: Step[]): Promise<GitSubmitContext> {
  let cur = ctx
  for (const step of steps) cur = await step(cur)
  return cur
}

export async function runWorkflow(options: GitSubmitOptions): Promise<GitSubmitContext> {
  try {
    // agent 且无 plan → 自动 prepare
    if (options.ai === 'agent' && !options.commitPlan && !options.prepare) {
      options = { ...options, prepare: true }
    }

    const steps: Step[] = []
    if (!options.noPull) steps.push(stepPull)
    steps.push(stepConflict, stepDiff, stepHistory, stepAnalyze)
    if (!options.prepare) {
      steps.push(stepCommit)
      if (!options.noPush) steps.push(stepPush)
    }

    return await runSteps(await createContext(options), steps)
  } catch (e) {
    if (e instanceof GitSubmitError) throw e
    throw new GitSubmitError(e instanceof Error ? e.message : String(e))
  }
}
