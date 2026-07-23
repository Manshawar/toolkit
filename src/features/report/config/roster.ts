/**
 * 启动双区交互：上区名单（勾选采集 / 改日报名），下区附带信息。
 * ↑↓ 移动 · 空格 开/关 · e 改名 · Tab 切区 · Enter 开始
 */
import chalk from 'chalk'
import type { RepoEntry } from '../types'
import { applyRoster } from './setting'

export type RosterRow = {
  path: string
  alias: string
  display_name: string
  enabled: boolean
}

export type RosterResult = {
  repos: RosterRow[]
  append: string
}

type Focus = 'list' | 'append' | 'edit'

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 1)}…` : s
  return t.padEnd(n, ' ')
}

function render(state: {
  rows: RosterRow[]
  cursor: number
  focus: Focus
  append: string
  editBuf: string
}): string {
  const lines: string[] = []
  lines.push(chalk.bold('tkt report · 今日采集名单'))
  lines.push(
    chalk.dim(
      '↑↓ 移动  空格 开/关采集  e 改日报名  Tab 切到附带  Enter 开始  Ctrl+C 取消',
    ),
  )
  lines.push(
    chalk.dim('格式：项目目录名 │ 日报用名（可改） │ 勾选后才采集；空格取消可不采集个人项目'),
  )
  lines.push(chalk.dim('─'.repeat(64)))

  if (!state.rows.length) {
    lines.push(chalk.yellow('（暂无仓库；可用 --user-repo 追加）'))
  }

  for (let i = 0; i < state.rows.length; i++) {
    const r = state.rows[i]!
    const on = state.focus === 'list' && state.cursor === i
    const mark = r.enabled ? chalk.green('[x]') : chalk.gray('[ ]')
    const alias = pad(r.alias, 18)
    const name =
      state.focus === 'edit' && state.cursor === i
        ? chalk.cyan(`${state.editBuf}▍`)
        : pad(r.display_name || '(未命名)', 16)
    const tip = r.enabled ? '' : chalk.dim('  ← 不采集')
    const row = `${mark} ${alias} ${name}${tip}`
    lines.push(on ? chalk.bgGray.white(` ${row} `) : `  ${row}`)
  }

  lines.push(chalk.dim('─'.repeat(64)))
  const appendOn = state.focus === 'append'
  lines.push(appendOn ? chalk.bold('附带信息（杂事等，可空）') : chalk.dim('附带信息（杂事等，可空）'))
  const input = appendOn ? `${state.append}█` : state.append || chalk.dim('(空)')
  lines.push(appendOn ? chalk.cyan(`> ${input}`) : chalk.dim(`> ${input}`))
  return lines.join('\n')
}

function readKey(): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (buf: Buffer) => {
      cleanup()
      resolve(buf.toString('utf8'))
    }
    const onErr = (e: Error) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      process.stdin.off('data', onData)
      process.stdin.off('error', onErr)
    }
    process.stdin.on('data', onData)
    process.stdin.on('error', onErr)
  })
}

/**
 * 交互选仓；非 TTY 直接返回当前 enabled + 空 append。
 */
export async function promptRoster(repos: RepoEntry[]): Promise<RosterResult> {
  const rows: RosterRow[] = repos.map((r) => ({
    path: r.path,
    alias: r.alias,
    display_name: r.display_name,
    enabled: Boolean(r.enabled),
  }))

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { repos: rows, append: '' }
  }

  const state = {
    rows,
    cursor: Math.max(
      0,
      rows.findIndex((r) => r.enabled),
    ),
    focus: 'list' as Focus,
    append: '',
    editBuf: '',
  }
  if (state.cursor < 0) state.cursor = 0

  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  stdin.setRawMode?.(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  let painted = 0
  const paint = () => {
    const text = render(state)
    if (painted > 0) {
      process.stdout.write(`\x1b[${painted}A\x1b[0J`)
    }
    process.stdout.write(text + '\n')
    painted = text.split('\n').length
  }

  const finish = (ok: boolean): RosterResult => {
    stdin.setRawMode?.(wasRaw ?? false)
    stdin.pause()
    process.stdout.write('\n')
    if (!ok) {
      console.error(chalk.yellow('已取消'))
      process.exit(0)
    }
    applyRoster(
      state.rows.map((r) => ({
        path: r.path,
        display_name: r.display_name,
        enabled: r.enabled,
      })),
    )
    return { repos: state.rows, append: state.append.trim() }
  }

  paint()

  while (true) {
    const key = await readKey()

    if (key === '\u0003') return finish(false) // Ctrl+C
    if (key === '\u001b') {
      // bare Esc：取消改名 / 取消
      if (state.focus === 'edit') {
        state.focus = 'list'
        state.editBuf = ''
        paint()
        continue
      }
      return finish(false)
    }

    // 方向键：ESC [ A/B
    if (key.startsWith('\u001b[')) {
      const code = key.slice(2)
      if (state.focus === 'list') {
        if (code === 'A' && state.cursor > 0) state.cursor--
        if (code === 'B' && state.cursor < state.rows.length - 1) state.cursor++
      }
      if (code === 'Z') {
        // Shift+Tab
        state.focus = state.focus === 'append' ? 'list' : 'append'
      }
      paint()
      continue
    }

    if (state.focus === 'edit') {
      if (key === '\r' || key === '\n') {
        const row = state.rows[state.cursor]
        if (row) row.display_name = state.editBuf.trim() || row.display_name
        state.focus = 'list'
        state.editBuf = ''
        paint()
        continue
      }
      if (key === '\u007f' || key === '\b') {
        state.editBuf = state.editBuf.slice(0, -1)
        paint()
        continue
      }
      if (key.length === 1 && key >= ' ') {
        state.editBuf += key
        paint()
        continue
      }
      continue
    }

    if (key === '\t') {
      state.focus = state.focus === 'list' ? 'append' : 'list'
      paint()
      continue
    }

    if (key === '\r' || key === '\n') {
      return finish(true)
    }

    if (state.focus === 'append') {
      if (key === '\u007f' || key === '\b') {
        state.append = state.append.slice(0, -1)
        paint()
        continue
      }
      if (key.length === 1 && key >= ' ') {
        state.append += key
        paint()
        continue
      }
      continue
    }

    // list
    if (key === ' ') {
      const row = state.rows[state.cursor]
      if (row) row.enabled = !row.enabled
      paint()
      continue
    }
    if (key === 'e' || key === 'E') {
      const row = state.rows[state.cursor]
      if (row) {
        state.focus = 'edit'
        state.editBuf = row.display_name
        paint()
      }
      continue
    }
    if (key === 'j' && state.cursor < state.rows.length - 1) {
      state.cursor++
      paint()
      continue
    }
    if (key === 'k' && state.cursor > 0) {
      state.cursor--
      paint()
      continue
    }
  }
}
