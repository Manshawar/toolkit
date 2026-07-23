/** 远程同步：pull（可跳过无 upstream）+ push（Gerrit：grp + 普通 push） */
import { createGit, currentBranch, listRemotes, pushOrigin } from '../../core/git'
import { createSpinner, withSpinner } from '../../ui'
import { runGrp } from '../grp'
import { GitSubmitError } from './errors'
import type { Step } from './types'

export const stepPull: Step = async (ctx) => {
  const quiet = Boolean(ctx.options.json)
  const spin = createSpinner('pull', { quiet })
  spin.start()
  try {
    await createGit(ctx.cwd).pull()
    spin.succeed('pull')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/no tracking information|There is no tracking information/i.test(msg)) {
      spin.succeed('pull skipped (no upstream)')
      return ctx
    }
    spin.fail(`pull: ${msg}`)
    throw e
  }
  return ctx
}

export const stepPush: Step = async (ctx) => {
  if (ctx.options.dryRun) return { ...ctx, pushed: false }

  const quiet = Boolean(ctx.options.json)
  const git = createGit(ctx.cwd)
  const remotes = await listRemotes(git)
  if (remotes.length === 0) throw new GitSubmitError('无 remote')

  const branch = ctx.branch || (await currentBranch(git))
  const isGerrit = ctx.isGerrit ?? remotes.some((r) => r.isGerrit)

  // Gerrit：先 refs/for/（评审），再普通 push（无合并权限时直接进分支）
  if (isGerrit) {
    await withSpinner('push (gerrit)', async () => runGrp(ctx.cwd), { quiet })
  }

  await withSpinner(
    `push ${branch}`,
    async () => {
      try {
        await git.push()
      } catch {
        await pushOrigin(branch, git)
      }
    },
    { quiet },
  )
  return { ...ctx, pushed: true, isGerrit }
}
