/**
 * 名单交互：列表空格勾选；e 跳出去改名再跳回；
 * o 切换「下次是否进名单」；Enter → 附带信息。
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import type { RepoEntry } from '../types'
import { projectLabel } from './guess-name'
import { applyRoster, loadSetting, setShowRoster } from './setting'

export type RosterRow = {
  path: string
  alias: string
  git_remote: string
  display_name: string
  enabled: boolean
  name_custom: boolean
}

export type RosterResult = {
  repos: RosterRow[]
  append: string
}

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
  return t.padEnd(n, ' ')
}

function renderList(rows: RosterRow[], cursor: number, showRoster: boolean): string {
  const lines: string[] = []
  lines.push(chalk.bold('tkt report · 今日采集名单'))
  lines.push('')
  lines.push(chalk.cyan('使用说明'))
  lines.push(chalk.dim('  ↑↓ / j k   移动光标'))
  lines.push(chalk.dim('  空格        开/关采集（取消勾选则今日不采该仓）'))
  lines.push(chalk.dim('  e          跳转改「日报书写名」(中文)，改完自动回到本名单'))
  lines.push(chalk.dim('  o          名单开关：开=下次仍进名单；关=下次直接进附带输入'))
  lines.push(chalk.dim('  Enter      进入附带信息输入，确认后开始采集'))
  lines.push(chalk.dim('  Ctrl+C     取消'))
  lines.push('')
  lines.push(
    chalk.dim('列：') +
      ` 勾选 │ ${chalk.bold('项目标识名(英文)')} │ ${chalk.bold('日报书写名(中文)')}`,
  )
  const sw = showRoster ? chalk.green('开（下次进名单）') : chalk.yellow('关（下次直达输入框）')
  lines.push(`名单开关 [o]：${sw}    重新打开：tkt report --roster`)
  lines.push(chalk.dim('─'.repeat(66)))

  if (!rows.length) {
    lines.push(chalk.yellow('（暂无仓库；可用 --user-repo 追加）'))
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!
    const on = cursor === i
    const mark = r.enabled ? chalk.green('[x]') : chalk.gray('[ ]')
    const proj = pad(projectLabel(r), 22)
    const name = pad(r.display_name || '(未命名)', 18)
    const tip = r.enabled ? '' : chalk.dim('  ← 不采集')
    const row = `${mark}  ${proj}  ${name}${tip}`
    lines.push(on ? chalk.inverse(` ${row} `) : `  ${row}`)
  }

  lines.push(chalk.dim('─'.repeat(66)))
  return lines.join('\n')
}

function readRawKey(stdin: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer) => {
      cleanup()
      resolve(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    }
    const onErr = (e: Error) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.off('error', onErr)
    }
    stdin.on('data', onData)
    stdin.on('error', onErr)
  })
}

function enterRaw(stdin: NodeJS.ReadStream): boolean {
  const wasRaw = Boolean(stdin.isRaw)
  if (stdin.isTTY) stdin.setRawMode(true)
  if (stdin.isPaused()) stdin.resume()
  return wasRaw
}

function leaveRaw(stdin: NodeJS.ReadStream, wasRaw: boolean): void {
  if (stdin.isTTY) stdin.setRawMode(wasRaw)
}

async function jumpEditName(row: RosterRow): Promise<void> {
  const next = await p.text({
    message: `改日报名 · ${projectLabel(row)}`,
    placeholder: row.display_name || projectLabel(row),
    defaultValue: row.display_name || projectLabel(row),
    validate: (v) => ((v ?? '').trim() ? undefined : '不能为空'),
  })
  if (p.isCancel(next)) {
    p.cancel('已取消改名，回到名单')
    return
  }
  row.display_name = String(next).trim()
  row.name_custom = true
}

async function jumpAppend(hint?: string): Promise<string> {
  if (hint) console.log(chalk.dim(hint))
  const next = await p.text({
    message: '附带信息（杂事 / 本地仓库路径，可空）',
    placeholder: '联调支付 · 或 /path/to/repo',
  })
  if (p.isCancel(next)) {
    p.cancel('已取消')
    process.exit(0)
  }
  return String(next ?? '').trim()
}

/** 仅附带输入（名单开关关闭时） */
export async function promptAppendOnly(repos: RepoEntry[]): Promise<RosterResult> {
  const rows: RosterRow[] = repos.map((r) => ({
    path: r.path,
    alias: r.alias,
    git_remote: r.git_remote,
    display_name: r.display_name,
    enabled: Boolean(r.enabled),
    name_custom: Boolean(r.name_custom),
  }))
  console.log(
    chalk.dim(
      '名单开关：关 → 已跳过名单，沿用上次勾选。重新打开：tkt report --roster 或名单里按 o',
    ),
  )
  const append = await jumpAppend()
  return { repos: rows, append }
}

/**
 * 交互选仓；非 TTY 直接返回当前 enabled + 空 append。
 */
export async function promptRoster(repos: RepoEntry[]): Promise<RosterResult> {
  const rows: RosterRow[] = repos.map((r) => ({
    path: r.path,
    alias: r.alias,
    git_remote: r.git_remote,
    display_name: r.display_name,
    enabled: Boolean(r.enabled),
    name_custom: Boolean(r.name_custom),
  }))

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { repos: rows, append: '' }
  }

  let showRoster = loadSetting().show_roster !== false
  const stdin = process.stdin
  let cursor = Math.max(
    0,
    rows.findIndex((r) => r.enabled),
  )
  if (cursor < 0) cursor = 0

  let painted = 0
  const paint = () => {
    const text = renderList(rows, cursor, showRoster)
    if (painted > 0) process.stdout.write(`\x1b[${painted}A\x1b[0J`)
    process.stdout.write(text + '\n')
    painted = text.split('\n').length
  }

  const finish = (append: string): RosterResult => {
    applyRoster(
      rows.map((r) => ({
        path: r.path,
        display_name: r.display_name,
        enabled: r.enabled,
        name_custom: r.name_custom,
      })),
    )
    setShowRoster(showRoster)
    const n = rows.filter((r) => r.enabled).length
    p.outro(
      `${n ? `将采集 ${n} 个仓` : '未勾选仓库'} · 名单开关：${showRoster ? '开' : '关'}`,
    )
    return { repos: rows, append }
  }

  while (true) {
    const wasRaw = enterRaw(stdin)
    paint()

    let goEdit = false
    let goNext = false
    let cancelled = false

    listLoop: while (true) {
      const key = await readRawKey(stdin)

      if (key === '\u0003') {
        cancelled = true
        break listLoop
      }

      if (key.startsWith('\u001b')) {
        if (key === '\u001b') {
          cancelled = true
          break listLoop
        }
        if (key.includes('A') && cursor > 0) cursor--
        if (key.includes('B') && cursor < Math.max(0, rows.length - 1)) cursor++
        paint()
        continue
      }

      if (key === ' ' && rows[cursor]) {
        rows[cursor]!.enabled = !rows[cursor]!.enabled
        paint()
        continue
      }

      if (key === 'o' || key === 'O') {
        showRoster = !showRoster
        paint()
        continue
      }

      if ((key === 'e' || key === 'E') && rows[cursor]) {
        goEdit = true
        break listLoop
      }

      if (key === 'j' && cursor < rows.length - 1) {
        cursor++
        paint()
        continue
      }
      if (key === 'k' && cursor > 0) {
        cursor--
        paint()
        continue
      }

      if (key === '\r' || key === '\n') {
        goNext = true
        break listLoop
      }
    }

    leaveRaw(stdin, wasRaw)
    if (painted > 0) {
      process.stdout.write(`\x1b[${painted}A\x1b[0J`)
      painted = 0
    }

    if (cancelled) {
      p.cancel('已取消')
      process.exit(0)
    }

    if (goEdit) {
      const row = rows[cursor]
      if (row) await jumpEditName(row)
      continue
    }

    if (goNext) {
      const append = await jumpAppend()
      return finish(append)
    }
  }
}
