/**
 * deep_inspect_diff：默认主 Diff 已截断；文本过大时分页多次吞吐。
 * 场景：git-submit.commit-plan
 *
 * 用法：offset=0 起读，若 done=false 用返回的 nextOffset 再调，直到读完或够写 Plan。
 */
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import chalk from 'chalk'
import { PAGE_SIZE, slicePage } from '../../features/git-submit/compress'
import type { ToolLoadContext } from '../types'

const InspectSchema = z.object({
  path: z.string().describe('要继续读取的文件路径（须在当前 diff 列表中）'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('字符起点；首次 0，之后用上次返回的 nextOffset'),
  limit: z
    .number()
    .int()
    .min(500)
    .max(8000)
    .default(PAGE_SIZE)
    .describe(`本页最大字符数，默认 ${PAGE_SIZE}`),
})

export function createDeepInspectDiffTool(ctx: ToolLoadContext): ToolSet {
  const diff = ctx.diff
  if (!diff) return {}

  return {
    deep_inspect_diff: tool({
      description:
        '主 Diff 默认已截断。仅当文件标了 [truncated] 或一次读不下、需要更多上下文时调用。按 offset/limit 分页吞吐，可多次调用；够写 Plan 即停，勿强行读完全文。',
      inputSchema: InspectSchema,
      execute: async ({ path, offset, limit }) => {
        const file = diff.files.find((f) => f.path === path)
        if (!file) {
          return {
            ok: false as const,
            error: `文件不在 diff 中: ${path}`,
            available: diff.files.map((f) => f.path),
          }
        }

        const text = file.fullCompressed || file.patch || ''
        if (!text) {
          return {
            ok: true as const,
            path,
            status: file.status,
            note: '无 patch（可能是二进制/过大）',
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
