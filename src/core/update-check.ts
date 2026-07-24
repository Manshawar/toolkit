/**
 * CLI 版本检查（异步、不阻塞启动）：
 * - 后台拉 npm latest，有更新则 stderr 提示一行
 * - 记录上次检查时间 checkedAt；未满间隔不再请求
 * - 间隔默认 3h，可在 `tkt config ui` / `/setting` 改；prefs：~/.config/tkt/update/prefs.json
 * - 关闭：TKT_NO_UPDATE=1 / CI / --json / -v|-h / 间隔设为 0
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import chalk from 'chalk'
import { dataDir, ensureDataDir } from '@/core/paths'

const DEFAULT_INTERVAL_HOURS = 3
const FETCH_TIMEOUT_MS = 5000

interface CacheFile {
  /** 上次向 registry 请求的时间 */
  checkedAt: number
  latest?: string
}

export interface UpdatePrefs {
  /** 检查间隔（小时）；默认 3；0 = 关闭 */
  checkIntervalHours: number
}

function pkgMeta(): { name: string; version: string } {
  return {
    name: process.env.PKG_NAME || '@manshawar/tkt',
    version: process.env.PKG_VERSION || '0.0.0',
  }
}

function cachePath(): string {
  return path.join(dataDir('update'), 'check-cache.json')
}

/** 旧缓存路径（兼容一次） */
function legacyCachePath(): string {
  return path.join(os.homedir(), '.cache', 'tkt', 'update-check.json')
}

function prefsPath(): string {
  return path.join(dataDir('update'), 'prefs.json')
}

function clampIntervalHours(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return DEFAULT_INTERVAL_HOURS
  return Math.min(168, Math.floor(n))
}

export function loadUpdatePrefs(): UpdatePrefs {
  try {
    const j = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Partial<UpdatePrefs>
    return { checkIntervalHours: clampIntervalHours(j.checkIntervalHours) }
  } catch {
    return { checkIntervalHours: DEFAULT_INTERVAL_HOURS }
  }
}

export function saveUpdatePrefs(partial: Partial<UpdatePrefs>): UpdatePrefs {
  const cur = loadUpdatePrefs()
  const next: UpdatePrefs = {
    checkIntervalHours:
      partial.checkIntervalHours !== undefined
        ? clampIntervalHours(partial.checkIntervalHours)
        : cur.checkIntervalHours,
  }
  ensureDataDir('update')
  fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

function readCache(): CacheFile | null {
  for (const p of [cachePath(), legacyCachePath()]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as CacheFile & {
        notifiedAt?: number
      }
      const checkedAt =
        typeof j.checkedAt === 'number'
          ? j.checkedAt
          : typeof j.notifiedAt === 'number'
            ? j.notifiedAt
            : NaN
      if (!Number.isFinite(checkedAt)) continue
      return { checkedAt, latest: j.latest }
    } catch {
      // try next
    }
  }
  return null
}

function writeCache(data: CacheFile): void {
  try {
    ensureDataDir('update')
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

  const prefs = loadUpdatePrefs()
  if (prefs.checkIntervalHours <= 0) return

  const { name, version: current } = pkgMeta()
  if (!current || current === '0.0.0') return

  const intervalMs = prefs.checkIntervalHours * 60 * 60 * 1000
  const now = Date.now()
  const cache = readCache()
  if (cache && now - cache.checkedAt < intervalMs) return

  const latest = await fetchLatest(name)
  writeCache({ checkedAt: now, latest: latest || cache?.latest })
  if (!latest || !isNewer(latest, current)) return

  console.error(
    chalk.yellow(
      `⚠ ${name} 有新版本 ${latest}（当前 ${current}）  升级: pnpm add -g ${name}@latest`,
    ),
  )
}

/** 异步调度：立即返回，不阻塞 CLI */
export function interceptCliUpdate(): void {
  void runUpdateCheck().catch(() => {})
}
