/**
 * 日报中文名：根据 git remote 末段 / 路径信息猜测。
 * 禁止把 KaoQin-Attendance、cldd-standard 这类英文直接当【项目】名。
 * name_custom 手动改过的不再覆盖。
 */
import { z } from 'zod'
import { createAiClient } from '@/ai'
import { withCatRun } from '@/ui'
import { applyRoster } from '../setting'
import type { RepoEntry } from '../types'

/** https://host/a/b/cldd-standard.git → cldd-standard */
export function remoteSlug(remote: string): string {
  if (!remote) return ''
  const cleaned = remote
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const parts = cleaned.split(/[:/]/).filter(Boolean)
  return parts[parts.length - 1] || ''
}

/** 名单左侧参考：remote 末段 */
export function projectLabel(repo: Pick<RepoEntry, 'git_remote' | 'alias'>): string {
  return remoteSlug(repo.git_remote) || repo.alias || 'unknown'
}

/** 已含汉字 → 视为可用中文名；纯英文/连字符则需猜测 */
export function needsChineseName(name: string): boolean {
  const t = name.trim()
  if (!t) return true
  return !/[\u4e00-\u9fff]/.test(t)
}

/** 本地速查（remote 末段 / alias → 中文），避免每次打 AI */
const LOCAL_ZH: Record<string, string> = {
  'cldd-standard': '车辆调度',
  cldd: '车辆调度',
  'KaoQin-Attendance': '考勤',
  KaoQin: '考勤',
  kaoqin: '考勤',
  Attendance: '考勤',
  toolkit: '工具箱',
  tkt: '工具箱',
}

export function localGuessZh(repo: Pick<RepoEntry, 'git_remote' | 'alias'>): string | null {
  const slug = remoteSlug(repo.git_remote)
  const keys = [slug, repo.alias, slug.split('-')[0], repo.alias.split('-')[0]].filter(Boolean)
  for (const k of keys) {
    const hit = LOCAL_ZH[k!] || LOCAL_ZH[k!.toLowerCase()]
    if (hit) return hit
  }
  // 拼音/英文片段启发
  const blob = `${slug} ${repo.alias}`.toLowerCase()
  if (/kaoqin|attendance|考勤/.test(blob)) return '考勤'
  if (/cldd|vehicle|调度/.test(blob)) return '车辆调度'
  if (/toolkit|tkt/.test(blob)) return '工具箱'
  return null
}

export function defaultDisplayName(repo: Pick<RepoEntry, 'git_remote' | 'alias'>): string {
  return localGuessZh(repo) || remoteSlug(repo.git_remote) || repo.alias || '未知项目'
}

const GuessSchema = z.object({
  names: z.array(
    z.object({
      path: z.string(),
      name: z.string().min(1),
    }),
  ),
})

/**
 * 未手动改名、且当前名不是中文的仓 → 猜中文名并写回。
 * 优先本地词典，其余走一次 AI。
 */
export async function fillMissingDisplayNames(
  repos: RepoEntry[],
  opts: { quiet?: boolean } = {},
): Promise<RepoEntry[]> {
  const need = repos.filter((r) => !r.name_custom && needsChineseName(r.display_name || ''))
  if (!need.length) return repos

  const byPath = new Map<string, string>()

  // 1) 本地猜
  for (const r of need) {
    const zh = localGuessZh(r)
    if (zh) byPath.set(r.path, zh)
  }

  // 2) 剩余打 AI
  const rest = need.filter((r) => !byPath.has(r.path))
  if (rest.length) {
    const payload = rest.map((r) => ({
      path: r.path,
      alias: r.alias,
      remote: r.git_remote,
      slug: remoteSlug(r.git_remote) || r.alias,
    }))
    try {
      // createAiClient 在动画外：缺配置先填，再「思考中」
      const ai = await createAiClient()
      const guessed = await withCatRun(
        'guess-name',
        async () =>
          ai.generateObject({
            schema: GuessSchema,
            name: 'RepoDisplayNames',
            description: 'Chinese short names for daily report projects',
            system: [
              '你为公司日报猜测「项目中文简称」。',
              '依据 git remote 末段、路径、拼音/英文缩写翻译成 2～8 个汉字。',
              '示例：cldd-standard→车辆调度；KaoQin-Attendance→考勤；toolkit→工具箱。',
              '禁止输出英文、拼音、连字符、仓库目录名本身。',
              '不要加「项目」后缀。只输出 JSON。',
            ].join('\n'),
            user: JSON.stringify(payload, null, 2),
          }),
        { quiet: Boolean(opts.quiet) },
      )
      for (const n of guessed.names) {
        const name = n.name.trim()
        if (name && !needsChineseName(name)) byPath.set(n.path, name)
      }
    } catch {
      /* AI 失败则下面用本地/占位 */
    }
  }

  return applyRoster(
    repos.map((r) => {
      if (r.name_custom && String(r.display_name || '').trim()) {
        return {
          path: r.path,
          display_name: r.display_name,
          enabled: r.enabled,
          name_custom: true,
        }
      }
      const cur = String(r.display_name || '').trim()
      const next =
        byPath.get(r.path) ||
        (!needsChineseName(cur) ? cur : localGuessZh(r) || cur || '未知项目')
      return {
        path: r.path,
        display_name: next,
        enabled: r.enabled,
        name_custom: false,
      }
    }),
  )
}
