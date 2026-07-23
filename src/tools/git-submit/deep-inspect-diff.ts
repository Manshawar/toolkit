/**
 * deep_inspect_diff：分页吞吐；描述文案来自 prompts/。
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import chalk from 'chalk'
import { PAGE_SIZE, slicePage } from '../../features/git-submit/collect/compress'
import { loadPromptJson } from '../../features/prompts'
import type { ToolLoadContext } from '../types'

interface ToolMeta {
  description: string
  params: {
    path: string
    offset: string
    limit: string
  }
}

const META_ID = 'git-submit.deep-inspect-diff'

export function createDeepInspectDiffTool(ctx: ToolLoadContext): ToolSet {
  const diff = ctx.diff
  if (!diff) return {}

  const meta = loadPromptJson<ToolMeta>(META_ID)

  const InspectSchema = z.object({
    path: z.string().describe(meta.params.path),
    offset: z.number().int().min(0).default(0).describe(meta.params.offset),
    limit: z
      .number()
      .int()
      .min(500)
      .max(8000)
      .default(PAGE_SIZE)
      .describe(meta.params.limit),
  })

  return {
    deep_inspect_diff: tool({
      description: meta.description,
      inputSchema: InspectSchema,
      execute: async ({ path, offset, limit }) => {
        const file = diff.files.find((f) => f.path === path)
        if (!file) {
          return {
            ok: false as const,
            error: `not in diff: ${path}`,
            available: diff.files.map((f) => f.path),
          }
        }

        const text = file.fullCompressed || file.patch || ''
        if (!text) {
          return {
            ok: true as const,
            path,
            status: file.status,
            note: 'empty patch',
            additions: file.additions,
            deletions: file.deletions,
            done: true,
          }
        }

        const page = slicePage(text, offset, limit)
        console.log(
          chalk.dim(
            `  tool deep_inspect_diff ← ${path} p${page.page}/${page.pages} @${page.offset}`,
          ),
        )

        return {
          ok: true as const,
          path,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          total: page.total,
          offset: page.offset,
          nextOffset: page.nextOffset,
          done: page.done,
          page: page.page,
          pages: page.pages,
          chunk: page.chunk,
        }
      },
    }),
  }
}
