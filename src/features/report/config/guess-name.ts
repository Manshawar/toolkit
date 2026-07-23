/**
 * 按 git remote 末段猜日报中文名；一次成功写入 display_name，之后复用。
 */
import { z } from 'zod'
import { createAiClient } from '../../../ai'
import { withCatRun } from '../../../ui'
import type { RepoEntry } from '../types'
import { applyRoster } from './setting'

const GuessSchema = z.object({
  names: z.array(
    z.object({
      path: z.string(),
      name: z.string().min(1),
    }),
  ),
})

export function remoteSlug(remote: string): string {
  if (!remote) return ''
  const cleaned = remote
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const parts = cleaned.split(/[:/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** 对 display_name 为空的仓批量猜名并写回 */
export async function fillMissingDisplayNames(
  repos: RepoEntry[],
  opts: { quiet?: boolean } = {},
): Promise<RepoEntry[]> {
  const missing = repos.filter((r) => !r.display_name.trim())
  if (!missing.length) return repos

  const payload = missing.map((r) => ({
    path: r.path,
    alias: r.alias,
    remote: r.git_remote,
    slug: remoteSlug(r.git_remote) || r.alias,
  }))

  try {
    const guessed = await withCatRun(
      'guess-name',
      async () => {
        const ai = await createAiClient()
        return ai.generateObject({
          schema: GuessSchema,
          name: 'RepoDisplayNames',
          description: 'Chinese short names for daily report',
          system: [
            '你为公司日报猜「项目中文简称」。',
            '根据 git remote 末段 / 目录 alias 翻译或概括成 2～10 字中文名。',
            '不要加「项目」后缀；不要路径；不要英文堆砌。',
            '只输出 JSON。',
          ].join('\n'),
          user: JSON.stringify(payload, null, 2),
        })
      },
      { quiet: Boolean(opts.quiet) },
    )

    const byPath = new Map(guessed.names.map((n) => [n.path, n.name.trim()]))
    const updates = repos.map((r) => {
      if (r.display_name.trim()) {
        return { path: r.path, display_name: r.display_name, enabled: r.enabled }
      }
      const name = byPath.get(r.path) || remoteSlug(r.git_remote) || r.alias
      return { path: r.path, display_name: name, enabled: r.enabled }
    })
    return applyRoster(updates)
  } catch {
    // AI 失败：用 remote slug / alias 占位，仍可在名单里改
    return applyRoster(
      repos.map((r) => ({
        path: r.path,
        display_name: r.display_name.trim() || remoteSlug(r.git_remote) || r.alias,
        enabled: r.enabled,
      })),
    )
  }
}
