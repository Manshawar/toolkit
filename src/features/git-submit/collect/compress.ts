/**
 * Diff / 代码片段压缩：去掉不影响语义阅读的空白，再按预算截断。
 * 默认主 prompt 截断；过长内容经 tool 分页多次吞吐。
 */

/** 单文件喂给主模型的压缩后上限（默认截断） */
export const MAX_PATCH = 2000
/** 主 prompt 总 Diff 预算 */
export const MAX_SUMMARY = 16000
/** tool 单次分页吞吐大小 */
export const PAGE_SIZE = 3000
/** 内存中保留的压缩全文上限（再长也丢弃尾部，避免 OOM） */
export const MAX_STORE = 100_000

/** 压缩空白：保留行首 diff 标记，折叠空行与连续空格 */
export function compressSnippet(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  let blank = 0

  for (const line of lines) {
    const isDiffLine =
      /^[+\- @\\]/.test(line) || line.startsWith('diff ') || line.startsWith('index ')
    let body = isDiffLine && line.length > 0 ? line.slice(0, 1) + line.slice(1) : line

    if (/^[+\- ]/.test(body) && body.length > 1) {
      const mark = body[0]
      const rest = body
        .slice(1)
        .replace(/[ \t]+/g, ' ')
        .replace(/\s+$/g, '')
      body = mark + rest
      if (mark === ' ' && rest === '') {
        blank++
        if (blank > 1) continue
        out.push(mark)
        continue
      }
    } else {
      body = body.replace(/[ \t]+/g, ' ').replace(/\s+$/g, '')
    }

    if (body === '' || body === '+' || body === '-') {
      blank++
      if (blank > 1) continue
      out.push(body)
      continue
    }
    blank = 0
    out.push(body)
  }

  return out.join('\n').trim()
}

export function truncate(text: string, max: number, marker = '…[truncated]'): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - marker.length))}${marker}`
}

/** 先压缩再截断；返回是否发生截断 */
export function compressAndTruncate(
  text: string,
  max: number,
): { text: string; truncated: boolean; compressedLen: number; full: string } {
  let full = compressSnippet(text)
  if (full.length > MAX_STORE) {
    full = truncate(full, MAX_STORE, '…[store-capped]')
  }
  const truncated = full.length > max
  return {
    text: truncated ? truncate(full, max) : full,
    truncated,
    compressedLen: full.length,
    full,
  }
}

/** 按字符分页；offset 为起点，limit 为页长 */
export function slicePage(
  text: string,
  offset = 0,
  limit = PAGE_SIZE,
): {
  chunk: string
  offset: number
  nextOffset: number | null
  total: number
  done: boolean
  page: number
  pages: number
} {
  const total = text.length
  const start = Math.max(0, Math.min(offset, total))
  const end = Math.min(start + Math.max(1, limit), total)
  const chunk = text.slice(start, end)
  const done = end >= total
  const pages = total === 0 ? 0 : Math.ceil(total / limit)
  const page = total === 0 ? 0 : Math.floor(start / limit) + 1
  return {
    chunk,
    offset: start,
    nextOffset: done ? null : end,
    total,
    done,
    page,
    pages,
  }
}
