import { currentBranch, pushOrigin } from './git'

/** Gerrit：HEAD:refs/for/<branch> */
export async function runGrp(): Promise<void> {
  const branch = await currentBranch()
  const ref = `HEAD:refs/for/${branch}`
  await pushOrigin(ref)
  console.log(ref)
}
