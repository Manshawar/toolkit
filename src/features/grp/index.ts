/** Gerrit：HEAD:refs/for/<branch> */
import { createGit, currentBranch, pushOrigin } from '@/core/git'

export async function runGrp(cwd = process.cwd()): Promise<void> {
  const git = createGit(cwd)
  const branch = await currentBranch(git)
  const ref = `HEAD:refs/for/${branch}`
  await pushOrigin(ref, git)
  console.log(ref)
}
