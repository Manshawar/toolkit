/** 远程同步：pull（可跳过无 upstream）+ push（Gerrit → grp） */
import chalk from 'chalk'
import { createGit, currentBranch, listRemotes, pushOrigin } from '../../lib/git'
import { runGrp } from '../grp'
import { GitSubmitError } from './errors'
import type { Step } from './types'

export const stepPull: Step = async (ctx) => {
  console.log(chalk.dim('→ pull'))
  try {
    await createGit(ctx.cwd).pull()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/no tracking information|There is no tracking information/i.test(msg)) {
      console.log(chalk.yellow('无上游跟踪，跳过 pull'))
      return ctx
    }
    throw e
  }
  return ctx
}

export const stepPush: Step = async (ctx) => {
  if (ctx.options.dryRun) return { ...ctx, pushed: false }

  console.log(chalk.dim('→ push'))
  const git = createGit(ctx.cwd)
  const remotes = await listRemotes(git)
  if (remotes.length === 0) throw new GitSubmitError('无 remote')

  const isGerrit = ctx.isGerrit ?? remotes.some((r) => r.isGerrit)
  if (isGerrit) {
    console.log(chalk.dim('  Gerrit → grp'))
    await runGrp(ctx.cwd)
    return { ...ctx, pushed: true, isGerrit: true }
  }

  const branch = ctx.branch || (await currentBranch(git))
  try {
    await git.push()
  } catch {
    await pushOrigin(branch, git)
  }
  console.log(chalk.green(`✔ pushed ${branch}`))
  return { ...ctx, pushed: true }
}
