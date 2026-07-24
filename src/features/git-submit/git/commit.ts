/** 按 CommitPlan 落库：单 commit 提交 diff 全部文件；多 commit 按 files 拆分 */
import chalk from 'chalk'
import { createGit } from '@/core/git'
import { createSpinner } from '@/ui'
import { listPendingPaths } from '../collect'
import { GitSubmitError } from '../errors'
import type { Step } from '../types'

export const stepCommit: Step = async (ctx) => {
  if (ctx.options.dryRun) return ctx
  if (!ctx.commitPlan) throw new GitSubmitError('缺少 CommitPlan')

  const quiet = Boolean(ctx.options.json)
  const spin = createSpinner('commit', { quiet })
  spin.start()

  try {
    const git = createGit(ctx.cwd)
    const hashes: string[] = []
    const { commits } = ctx.commitPlan

    if (commits.length === 1) {
      const c = commits[0]
      const paths = ctx.diff?.files.map((f) => f.path) ?? []
      if (paths.length === 0) throw new GitSubmitError('无文件可提交')
      spin.update(`commit · ${c.message}`)
      await git.add(paths)
      const r = await git.commit(c.message)
      const hash = r.commit || (await git.revparse(['HEAD']))
      hashes.push(hash)
      spin.succeed(`${c.message} (${hash.slice(0, 7)})`)
    } else {
      for (let i = 0; i < commits.length; i++) {
        const c = commits[i]
        if (!c.files?.length) throw new GitSubmitError(`多 commit 必须指定 files: ${c.message}`)
        spin.update(`commit ${i + 1}/${commits.length} · ${c.message}`)
        await git.add(c.files)
        const status = await git.status()
        if (status.staged.length === 0 && status.created.length === 0) {
          throw new GitSubmitError(`无暂存文件: ${c.message}`)
        }
        const r = await git.commit(c.message)
        const hash = r.commit || (await git.revparse(['HEAD']))
        hashes.push(hash)
      }

      // 与 git log 一致：最新在上
      for (let i = commits.length - 1; i >= 0; i--) {
        const hash = hashes[i] ?? ''
        console.log(chalk.cyan(`  • ${commits[i].message} (${hash.slice(0, 7)})`))
      }

      spin.succeed(`commit × ${hashes.length}`)
    }

    const leftover = await listPendingPaths(ctx.cwd)
    if (leftover.length > 0 && !quiet) {
      console.log(chalk.yellow(`  ⚠ 仍有 ${leftover.length} 个文件未纳入本次 plan`))
      for (const p of leftover.slice(0, 12)) console.log(chalk.dim(`    · ${p}`))
      if (leftover.length > 12) console.log(chalk.dim(`    · … +${leftover.length - 12}`))
    }

    return { ...ctx, commitHashes: hashes, leftover }
  } catch (e) {
    if (spin.status === 'running') {
      spin.fail(e instanceof Error ? e.message : String(e))
    }
    throw e
  }
}
