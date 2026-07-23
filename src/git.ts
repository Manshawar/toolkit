import { simpleGit } from 'simple-git'
import type { SimpleGitOptions } from 'simple-git'

const options: Partial<SimpleGitOptions> = {
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  trimmed: false,
}

export const git = simpleGit(options)

export async function currentBranch(): Promise<string> {
  const branches = await git.branch()
  return branches.current
}

export async function pushOrigin(refspec: string): Promise<void> {
  await git.push('origin', refspec)
}
