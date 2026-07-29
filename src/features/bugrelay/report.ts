/**
 * bugrelay 结构化 bug 报告 markdown 生成。
 * 标题 + 测试描述 + 归属 + 证据 + 建议 + 路由/文件 + 环境 + 原始快照索引。
 */
import type { AnalysisResult } from './analyze'
import { getSession } from './session'

const ATTRIBUTION_LABEL: Record<string, string> = {
  frontend: '前端',
  backend: '后端',
  uncertain: '待定位',
}

export function buildBugReport(opts: {
  sessionId: string
  question: string
  analysis: AnalysisResult
}): string {
  const { sessionId, question, analysis } = opts
  const session = getSession(sessionId)
  const page = session?.page ?? {}
  const snapshot = session?.snapshot as Record<string, unknown> | null

  const lines: string[] = []
  lines.push(`## [bug] ${analysis.summary}`)
  lines.push('')
  lines.push(`**归属**：${ATTRIBUTION_LABEL[analysis.attribution] ?? analysis.attribution}（置信 ${analysis.confidence}）`)
  lines.push('')
  lines.push('### 测试描述')
  lines.push(question)
  lines.push('')
  if (analysis.evidence.length) {
    lines.push('### 依据')
    for (const e of analysis.evidence) lines.push(`- ${e}`)
    lines.push('')
  }
  if (analysis.suggestions.length) {
    lines.push('### 建议')
    for (const s of analysis.suggestions) lines.push(`- ${s}`)
    lines.push('')
  }
  if (analysis.routes.length || analysis.files.length) {
    lines.push('### 涉及路由 / 文件')
    for (const r of analysis.routes) lines.push(`- 路由 ${r}`)
    for (const f of analysis.files) lines.push(`- \`${f}\``)
    lines.push('')
  }
  lines.push('### 环境')
  if (page.url) lines.push(`- 页面：${page.url}${session?.route ? `（route: ${session.route}）` : ''}`)
  if (page.lanxinVer) lines.push(`- 蓝信版本：${page.lanxinVer}`)
  if (page.net) lines.push(`- 网络：${page.net}`)
  if (page.ua) lines.push(`- UA：${page.ua}`)
  lines.push('')

  if (snapshot) {
    const reqs = Array.isArray(snapshot.requests) ? snapshot.requests.length : 0
    const logs = Array.isArray(snapshot.logs) ? snapshot.logs.length : 0
    const errs = Array.isArray(snapshot.errors) ? snapshot.errors.length : 0
    lines.push('### 采集快照')
    lines.push(`- 请求 ${reqs} 条 / 日志 ${logs} 条 / 异常 ${errs} 条`)
    // 附可疑请求明细（非 200 / errcode 异常），开发免再拉
    const suspicious = (Array.isArray(snapshot.requests) ? snapshot.requests : []).filter(
      (r: unknown) => {
        const req = r as { status?: number; errcode?: number }
        return (req.status !== undefined && req.status >= 400) || (req.errcode !== undefined && req.errcode !== 200)
      },
    )
    if (suspicious.length) {
      lines.push('- 可疑请求：')
      for (const r of suspicious.slice(0, 10)) {
        const req = r as { method?: string; url?: string; status?: number; errcode?: number; ms?: number }
        lines.push(
          `  - ${req.method ?? '?'} ${req.url ?? '?'} → status=${req.status ?? '-'} errcode=${req.errcode ?? '-'} ${req.ms ?? '-'}ms`,
        )
      }
    }
    lines.push('')
  }
  lines.push('---')
  lines.push(`由 tkt bugrelay 生成 · session=${sessionId}`)
  return lines.join('\n')
}
