/**
 * 用户数据根：~/.config/tkt/<arg>/
 * 每个 CLI 命令名一个目录；目录内分文件存放。
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

export function packageRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  for (const root of [path.resolve(dir, '..'), path.resolve(dir, '../..')]) {
    if (fs.existsSync(path.join(root, 'package.json'))) return root
  }
  return path.resolve(dir, '..')
}

/** ~/.config/tkt/<arg> */
export function dataDir(arg: string): string {
  return path.join(os.homedir(), '.config', 'tkt', arg)
}

export function ensureDataDir(arg: string): string {
  const dir = dataDir(arg)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 包内静态资源（如 assets/bench/ui.html） */
export function assetPath(...parts: string[]): string {
  return path.join(packageRoot(), 'assets', ...parts)
}
