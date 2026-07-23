/**
 * CLI 版本检查（异步、不阻塞启动）：
 * - 后台拉 npm latest，有更新则 stderr 提示一行
 * - 记录上次提示时间 notifiedAt；未满 24h 不再提醒、也不重复请求
 * - 关闭：TKT_NO_UPDATE=1 / CI / --json / -v|-h
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import chalk from 'chalk'

const REMIND_AFTER_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000

interface CacheFile {
  /** 上次向用户提示的时间 */
  notifiedAt: number
  latest?: string
}

function pkgMeta(): { name: string; version: string } {
  return {
    name: process.env.PKG_NAME || '@manshawar/tkt',
    version: process.env.PKG_VERSION || '0.0.0',
  }
}

function cachePath(): string {
  return path.join(os.homedir(), '.cache', 'tkt', 'update-check.json')
}

function readCache(): CacheFile | null {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile
    if (typeof j.notifiedAt !== 'number') return null
    return j
  } catch {
    return null
  }
}

function writeCache(data: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
    fs.writeFileSync(cachePath(), JSON.stringify(data), 'utf8')
  } catch {
    // ignore
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

function shouldSkip(): boolean {
  if (process.env.TKT_NO_UPDATE === '1' || process.env.TKT_NO_UPDATE === 'true') return true
  if (process.env.CI === 'true') return true
  const argv = process.argv.slice(2)
  return argv.some(
    (a) =>
      a === '--json' ||
      a === '-h' ||
      a === '--help' ||
      a === '-v' ||
      a === '--vers' ||
      a === '--version',
  )
}

async function fetchLatest(name: string): Promise<string | null> {
  // dist-tags 比 /latest 更稳
  const url = `https://registry.npmjs.org/-/package/${name}/dist-tags`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { latest?: string }
    return body.latest?.trim() || null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function runUpdateCheck(): Promise<void> {
  if (shouldSkip()) return

  const { name, version: current } = pkgMeta()
  if (!current || current === '0.0.0') return

  const now = Date.now()
  const cache = readCache()
  // 24h 内已提示过 → 不再请求、不再提醒
  if (cache && now - cache.notifiedAt < REMIND_AFTER_MS) return

  const latest = await fetchLatest(name)
  if (!latest || !isNewer(latest, current)) return

  console.error(
    chalk.yellow(
      `⚠ ${name} 有新版本 ${latest}（当前 ${current}）  升级: pnpm add -g ${name}@latest`,
    ),
  )
  writeCache({ notifiedAt: now, latest })
}

/** 异步调度：立即返回，不阻塞 CLI */
export function interceptCliUpdate(): void {
  void runUpdateCheck().catch(() => {})
}
