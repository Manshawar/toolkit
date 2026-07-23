/**
 * 收集阶段：conflict 门禁 → diff（压缩+截断）→ style summary。
 */
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { createGit } from '../../lib/git'
import {
  MAX_PATCH,
  MAX_SUMMARY,
  compressAndTruncate,
  truncate,
} from './compress'
import { GitSubmitError } from './errors'
import type { DiffInfo, FileDiff, Step, StyleSummary } from './types'

const JUNK_RE = /(\.log$|\.tmp$|(^|\/)(node_modules|dist|build|lib)\/|\.DS_Store$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$)/
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
  console.log(chalk.dim('→ collect diff'))
  const git = createGit(ctx.cwd)
  const status = await git.status()
  const paths = [...status.files.map((f) => f.path), ...status.not_added].filter(
    (p, i, arr) => arr.indexOf(p) === i && !JUNK_RE.test(p),
  )
  if (paths.length === 0) throw new GitSubmitError('工作区干净，无需提交', 'CLEAN')

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
      const flag = f.truncated
        ? ` [truncated ${f.compressedLen}c→deep_inspect_diff分页]`
        : ''
      return `- ${f.status} ${f.path} (+${f.additions}/-${f.deletions})${flag}`
    })
    .join('\n')

  let body = files
    .map((f) => `### ${f.status} ${f.path} (+${f.additions}/-${f.deletions})\n${f.patch ?? ''}`)
    .join('\n')
  const summaryTruncated = body.length > MAX_SUMMARY
  body = truncate(body, MAX_SUMMARY)

  const summary = `## Files\n${index}\n\n## Diff(compressed)\n${body}`

  console.log(
    chalk.dim(
      `  ${files.length} file(s)${truncatedCount ? `，${truncatedCount} 个已截断` : ''}${summaryTruncated ? '，总预算截断' : ''}`,
    ),
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
        text: '无历史；默认 Conventional 中文短句，无句号，禁「解决」。',
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
  const style: StyleSummary = {
    sampleSize: n,
    conventionalRatio: conventional / n,
    typeDistribution,
    avgLength: Math.round(lenSum / n),
    chineseRatio: cn / n,
    hasPeriodRatio: period / n,
    hasResolveWordRatio: resolve / n,
    samples: samples.slice(0, 8),
    text: '',
  }

  const top = Object.entries(typeDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, c]) => `${t}:${c}`)
    .join(', ')

  style.text = [
    `样本 ${n}；Conventional ${(style.conventionalRatio * 100).toFixed(0)}%；中文 ${(style.chineseRatio * 100).toFixed(0)}%；均长 ${style.avgLength}`,
    top ? `常见 type: ${top}` : 'type 不明显',
    style.conventionalRatio >= 0.4 ? '优先 type: 描述' : '可不强制 Conventional',
    style.chineseRatio >= 0.5 ? '中文描述' : '可用英文',
    style.hasPeriodRatio < 0.3 ? '不要句号' : '可有句号',
    style.hasResolveWordRatio < 0.2 ? '不要「解决」' : '可用「解决」',
    `样本: ${style.samples.map((s) => JSON.stringify(s)).join(' | ')}`,
  ].join('\n')

  return { ...ctx, style }
}
