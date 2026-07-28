import type { ReportItem } from '@web/pages/report/types'

/** 与后端 deliver.formatDaily 对齐，供粘贴用工时表 */
function halfHour(n: number): number {
  return Math.min(4, Math.max(0.5, Math.round(n * 2) / 2))
}

export function formatDaily(items: ReportItem[]): string {
  return items
    .map((it, i) => {
      const h = halfHour(Number(it.hours) || 0.5)
      const hs = Number.isInteger(h) ? String(h) : h.toFixed(1)
      const text = String(it.text || '')
        .trim()
        .replace(/[。.]+$/, '')
      return `${i + 1}. 【${String(it.project || '').trim()}】${text}。- ${hs}小时`
    })
    .join('\n')
}
