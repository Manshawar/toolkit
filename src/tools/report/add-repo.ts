/**
 * add_repo：用户给出本地路径 → 校验 git → 入库并采当日 commit，供日报汇总。
 * 非 git 直接 ok:false 退出，不写库。
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import chalk from 'chalk'
import { addAndGatherRepo, mergeGatherRepo } from '@/features/report/gather'
import { loadPromptJson } from '@/features/prompts'
import type { ToolLoadContext } from '../types'

interface ToolMeta {
  description: string
  params: { path: string }
}

const META_ID = 'report.add-repo'

export function createAddRepoTool(ctx: ToolLoadContext): ToolSet {
  const report = ctx.report
  if (!report) return {}

  const meta = loadPromptJson<ToolMeta>(META_ID)
  const Schema = z.object({
    path: z.string().min(1).describe(meta.params.path),
  })

  return {
    add_repo: tool({
      description: meta.description,
      inputSchema: Schema,
      execute: async ({ path: raw }) => {
        const result = addAndGatherRepo(raw, {
          date: report.date,
          dayStart: report.dayStart,
          dayEnd: report.dayEnd,
        })

        if (!result.ok) {
          console.log(chalk.dim(`  tool add_repo ✗ ${result.path} · ${result.error}`))
          return result
        }

        mergeGatherRepo(report.gather, result.gather)
        console.log(
          chalk.dim(
            `  tool add_repo ← ${result.alias} · ${result.commitCount} commit(s)${
              result.display_name ? ` · ${result.display_name}` : ''
            }`,
          ),
        )

        return {
          ok: true as const,
          path: result.path,
          alias: result.alias,
          display_name: result.display_name,
          git_remote: result.git_remote,
          commitCount: result.commitCount,
          hours: result.gather?.hours ?? 0,
          project: result.gather?.project || result.display_name || result.alias,
          commits: result.gather?.commits ?? [],
          note:
            result.commitCount === 0
              ? 'added to library; no commits today'
              : 'added and merged into gather for daily plan',
        }
      },
    }),
  }
}
