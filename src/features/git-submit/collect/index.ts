/**
 * 收集阶段：conflict 门禁 → diff（压缩+截断）→ style summary。
 */
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { createGit } from '../../../core/git'
import { createSpinner } from '../../../ui'
import {
  MAX_PATCH,
  MAX_SUMMARY,
  compressAndTruncate,
  truncate,
} from './compress'
import { GitSubmitError } from '../errors'
import type { DiffInfo, FileDiff, Step, StyleSummary } from '../types'

/** 忽略构建产物 / 依赖；根目录 lib/ 为 tsup 产物。lockfile 有复现价值，不忽略。 */
const JUNK_RE =
  /(^|\/)(node_modules|dist|build)\/|(^|\/)\.DS_Store$|\.log$|\.tmp$|(^)lib\//
const CONVENTIONAL_RE =
  /^(feat|fix|refactor|style|docs|test|perf|build|ci|chore|revert)(\(.+\))?[!]?:\s+/i

export const stepConflict: Step = async (ctx) => {
  const conflicted = (await createGit(ctx.cwd).status()).conflicted
  if (conflicted.length > 0) {
    console.error(chalk.red('未解决冲突:'))
    for (const f of conflicted) console.error(`  ${f}`)
    throw new GitSubmitError('请先解决冲突', 'CONFLICT')
  }
  console.log(chalk.dim('→ conflict ok'))
  return ctx
}

export const stepDiff: Step = async (ctx) => {
  const quiet = Boolean(ctx.options.json)
  const spin = createSpinner('collect diff', { quiet })
  spin.start()
  try {
    const git = createGit(ctx.cwd)
    const status = await git.status()
    const paths = [...status.files.map((f) => f.path), ...status.not_added].filter(
      (p, i, arr) => arr.indexOf(p) === i && !JUNK_RE.test(p),
    )
    if (paths.length === 0) {
      spin.succeed('clean')
      throw new GitSubmitError('工作区干净，无需提交', 'CLEAN')
    }

    spin.update(`collect diff · ${paths.length} files`)

    const numstat = await git.raw(['diff', '--numstat', 'HEAD']).catch(() => '')
    const numMap = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstat.split('\n').filter(Boolean)) {
      const [a, d, ...rest] = line.split('\t')
      const p = rest.join('\t')
      if (!p) continue
      numMap.set(p, {
        additions: a === '-' ? 0 : parseInt(a, 10) || 0,
        deletions: d === '-' ? 0 : parseInt(d, 10) || 0,
      })
    }

    const files: FileDiff[] = []
    let truncatedCount = 0

    for (const filePath of paths) {
      const untracked = status.not_added.includes(filePath)
      const st = status.files.find((f) => f.path === filePath)
      const code = untracked
        ? '?'
        : st?.index !== ' ' && st?.index
          ? st.index
          : st?.working_dir || 'M'
      const nums = numMap.get(filePath) ?? { additions: 0, deletions: 0 }

      let statusLabel: FileDiff['status'] = 'modified'
      if (untracked || code === '?') statusLabel = 'untracked'
      else if (code === 'A') statusLabel = 'added'
      else if (code === 'D') statusLabel = 'deleted'
      else if (code === 'R') statusLabel = 'renamed'

      let raw = ''
      try {
        if (untracked) {
          const abs = path.join(ctx.cwd, filePath)
          const stat = fs.statSync(abs)
          if (stat.isFile() && stat.size < 512_000) {
            const body = fs.readFileSync(abs, 'utf8')
            raw = `--- /dev/null\n+++ b/${filePath}\n${body}`
          } else {
            raw = `[untracked binary/large] ${filePath}`
          }
        } else {
          raw =
            (await git.diff(['HEAD', '--', filePath])) ||
            (await git.raw(['diff', '--', filePath])) ||
            ''
        }
      } catch {
        raw = ''
      }

      const packed = raw ? compressAndTruncate(raw, MAX_PATCH) : null
      if (packed?.truncated) truncatedCount++

      files.push({
        path: filePath,
        status: statusLabel,
        additions: nums.additions,
        deletions: nums.deletions,
        patch: packed?.text,
        fullCompressed: packed?.full,
        compressedLen: packed?.compressedLen,
        truncated: packed?.truncated,
      })
    }

    const index = files
      .map((f) => {
        const flag = f.truncated ? ` [truncated chars=${f.compressedLen}]` : ''
        return `- ${f.status} ${f.path} (+${f.additions}/-${f.deletions})${flag}`
      })
      .join('\n')

    let body = files
      .map((f) => `### ${f.status} ${f.path} (+${f.additions}/-${f.deletions})\n${f.patch ?? ''}`)
      .join('\n')
    const summaryTruncated = body.length > MAX_SUMMARY
    body = truncate(body, MAX_SUMMARY)

    const summary = `## Files\n${index}\n\n## Diff(compressed)\n${body}`

    spin.succeed(
      `diff ${files.length} file(s)${truncatedCount ? ` · ${truncatedCount} truncated` : ''}${summaryTruncated ? ' · budget cut' : ''}`,
    )
    return {
      ...ctx,
      diff: {
        files,
        summary,
        hasChanges: true,
        summaryTruncated,
      } satisfies DiffInfo,
    }
  } catch (e) {
    if (e instanceof GitSubmitError && e.code === 'CLEAN') throw e
    if (spin.status === 'running') {
      spin.fail(e instanceof Error ? e.message : String(e))
    }
    throw e
  }
}

export const stepHistory: Step = async (ctx) => {
  console.log(chalk.dim('→ style'))
  const log = await createGit(ctx.cwd).log({ maxCount: 30 })
  const samples = log.all.map((c) => c.message.split('\n')[0]?.trim() || '').filter(Boolean)

  if (samples.length === 0) {
    return {
      ...ctx,
      style: {
        sampleSize: 0,
        conventionalRatio: 0,
        typeDistribution: {},
        avgLength: 0,
        chineseRatio: 0,
        hasPeriodRatio: 0,
        hasResolveWordRatio: 0,
        samples: [],
        text: '',
      } satisfies StyleSummary,
    }
  }

  const typeDistribution: Record<string, number> = {}
  let conventional = 0
  let lenSum = 0
  let cn = 0
  let period = 0
  let resolve = 0
  for (const s of samples) {
    lenSum += s.length
    if (/[\u4e00-\u9fff]/.test(s)) cn++
    if (/[。．.]$/.test(s)) period++
    if (/解决/.test(s)) resolve++
    const m = s.match(CONVENTIONAL_RE)
    if (m) {
      conventional++
      const t = m[1].toLowerCase()
      typeDistribution[t] = (typeDistribution[t] || 0) + 1
    }
  }

  const n = samples.length
  return {
    ...ctx,
    style: {
      sampleSize: n,
      conventionalRatio: conventional / n,
      typeDistribution,
      avgLength: Math.round(lenSum / n),
      chineseRatio: cn / n,
      hasPeriodRatio: period / n,
      hasResolveWordRatio: resolve / n,
      samples: samples.slice(0, 8),
      text: '',
    } satisfies StyleSummary,
  }
}
