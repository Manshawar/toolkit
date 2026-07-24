/**
 * 收集阶段：conflict 门禁 → diff（压缩+截断）→ style summary。
 * - 无提交历史：只列文件名，不读内容（首提交走 init）
 * - 图片/字体等资源：只记名字，不进 patch
 */
import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import { createGit } from '@/core/git'
import { createSpinner } from '@/ui'
import {
  MAX_PATCH,
  MAX_SUMMARY,
  compressAndTruncate,
  truncate,
} from './compress'
import { isAssetPath } from './files'
import { GitSubmitError } from '../errors'
import type { DiffInfo, FileDiff, Step, StyleSummary } from '../types'

/** 忽略构建产物 / 依赖；根目录 lib/ 为 tsup 产物。lockfile 有复现价值，不忽略。 */
const JUNK_RE =
  /(^|\/)(node_modules|dist|build)\/|(^|\/)\.DS_Store$|\.log$|\.tmp$|(^)lib\//
const CONVENTIONAL_RE =
  /^(feat|fix|refactor|style|docs|test|perf|build|ci|chore|revert|init)(\(.+\))?[!]?:\s+/i

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

    const initMode = Boolean(ctx.noHistory)
    spin.update(
      initMode
        ? `collect paths · ${paths.length} (init, skip content)`
        : `collect diff · ${paths.length} files`,
    )

    const numMap = new Map<string, { additions: number; deletions: number }>()
    if (!initMode) {
      const numstat = await git.raw(['diff', '--numstat', 'HEAD']).catch(() => '')
      for (const line of numstat.split('\n').filter(Boolean)) {
        const [a, d, ...rest] = line.split('\t')
        const p = rest.join('\t')
        if (!p) continue
        numMap.set(p, {
          additions: a === '-' ? 0 : parseInt(a, 10) || 0,
          deletions: d === '-' ? 0 : parseInt(d, 10) || 0,
        })
      }
    }

    const files: FileDiff[] = []
    let truncatedCount = 0
    let assetCount = 0

    for (const filePath of paths) {
      const untracked = status.not_added.includes(filePath)
      const st = status.files.find((f) => f.path === filePath)
      const code = untracked
        ? '?'
        : st?.index !== ' ' && st?.index
          ? st.index
          : st?.working_dir || 'M'
      const nums = numMap.get(filePath) ?? { additions: 0, deletions: 0 }
      const asset = isAssetPath(filePath)

      let statusLabel: FileDiff['status'] = 'modified'
      if (untracked || code === '?') statusLabel = 'untracked'
      else if (code === 'A') statusLabel = 'added'
      else if (code === 'D') statusLabel = 'deleted'
      else if (code === 'R') statusLabel = 'renamed'

      // 首提交 / 资源：不读内容，只留名字
      if (initMode || asset) {
        if (asset) assetCount++
        files.push({
          path: filePath,
          status: statusLabel,
          additions: nums.additions,
          deletions: nums.deletions,
          patch: asset ? `[asset] ${filePath}` : undefined,
          asset,
        })
        continue
      }

      let raw = ''
      try {
        if (untracked) {
          const abs = path.join(ctx.cwd, filePath)
          const stat = fs.statSync(abs)
          if (stat.isFile() && stat.size < 512_000) {
            const buf = fs.readFileSync(abs)
            if (buf.includes(0)) {
              raw = `[binary] ${filePath}`
            } else {
              const body = buf.toString('utf8')
              raw = `--- /dev/null\n+++ b/${filePath}\n${body}`
            }
          } else {
            raw = `[untracked large] ${filePath}`
          }
        } else {
          raw =
            (await git.diff(['HEAD', '--', filePath])) ||
            (await git.raw(['diff', '--', filePath])) ||
            ''
          if (/^Binary files /m.test(raw) || /GIT binary patch/i.test(raw)) {
            raw = `[binary] ${filePath}`
          }
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
        asset: false,
      })
    }

    const index = files
      .map((f) => {
        if (f.asset) return `- ${f.status} ${f.path} [asset]`
        const flag = f.truncated ? ` [truncated chars=${f.compressedLen}]` : ''
        return `- ${f.status} ${f.path} (+${f.additions}/-${f.deletions})${flag}`
      })
      .join('\n')

    // 主 summary：资源只出文件名行；代码才带 patch
    let body = files
      .map((f) => {
        if (f.asset) return `### ${f.status} ${f.path} [asset · name only]`
        return `### ${f.status} ${f.path} (+${f.additions}/-${f.deletions})\n${f.patch ?? ''}`
      })
      .join('\n')
    const summaryTruncated = body.length > MAX_SUMMARY
    body = truncate(body, MAX_SUMMARY)

    const summary = initMode
      ? `## Init (no history)\n仅文件列表，跳过内容与 AI。\n\n## Files\n${index}`
      : `## Files\n${index}\n\n## Diff(compressed)\n${body}`

    const bits = [
      initMode ? 'init paths' : `diff ${files.length} file(s)`,
      assetCount ? `${assetCount} asset` : '',
      truncatedCount ? `${truncatedCount} truncated` : '',
      summaryTruncated ? 'budget cut' : '',
    ].filter(Boolean)

    spin.succeed(bits.join(' · '))
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
  if (ctx.noHistory) {
    console.log(chalk.dim('→ style skipped (no history)'))
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

  console.log(chalk.dim('→ style'))
  let samples: string[] = []
  try {
    const log = await createGit(ctx.cwd).log({ maxCount: 30 })
    samples = log.all.map((c) => c.message.split('\n')[0]?.trim() || '').filter(Boolean)
  } catch {
    samples = []
  }

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
