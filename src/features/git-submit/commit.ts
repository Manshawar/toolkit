/** 按 CommitPlan 落库：单 commit 提交 diff 全部文件；多 commit 按 files 拆分 */
import chalk from 'chalk'
import { createGit } from '../../lib/git'
import { GitSubmitError } from './errors'
import type { Step } from './types'

export const stepCommit: Step = async (ctx) => {
  if (ctx.options.dryRun) return ctx
  if (!ctx.commitPlan) throw new GitSubmitError('缺少 CommitPlan')

  const git = createGit(ctx.cwd)
  const hashes: string[] = []
  const { commits } = ctx.commitPlan
  console.log(chalk.dim('→ commit'))

  if (commits.length === 1) {
    const c = commits[0]
    const paths = ctx.diff?.files.map((f) => f.path) ?? []
    if (paths.length === 0) throw new GitSubmitError('无文件可提交')
    await git.add(paths)
    const r = await git.commit(c.message)
    const hash = r.commit || (await git.revparse(['HEAD']))
    hashes.push(hash)
    console.log(chalk.green(`✔ ${c.message} (${hash.slice(0, 7)})`))
    return { ...ctx, commitHashes: hashes }
  }

  for (const c of commits) {
    if (!c.files?.length) throw new GitSubmitError(`多 commit 必须指定 files: ${c.message}`)
    await git.add(c.files)
    const status = await git.status()
    if (status.staged.length === 0 && status.created.length === 0) {
      throw new GitSubmitError(`无暂存文件: ${c.message}`)
    }
    const r = await git.commit(c.message)
    const hash = r.commit || (await git.revparse(['HEAD']))
    hashes.push(hash)
    console.log(chalk.green(`✔ ${c.message} (${hash.slice(0, 7)})`))
  }
  return { ...ctx, commitHashes: hashes }
}
