/**
 * 日报交互壳：默认落在「日报补充」输入框；不主动弹名单/工时。
 * ↑ 进入快捷键区（名单勾选 / e 改名 / t 工时窗）；↓ 或 Esc 回到输入框。
 * Enter 开始采集。
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import type { RepoEntry } from '../types'
import { projectLabel } from '../ai'
import { promptWorkWindow } from '../hours'
import { applyRoster, loadSetting, writeSetting } from '../setting'

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
  dayStart?: string
  dayEnd?: string
  /** 完成后是否复制剪贴板；默认 true */
  autoCopy: boolean
}

type Focus = 'append' | 'keys'

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s
  return t.padEnd(n, ' ')
}

function toRows(repos: RepoEntry[]): RosterRow[] {
  return repos.map((r) => ({
    path: r.path,
    alias: r.alias,
    git_remote: r.git_remote,
    display_name: r.display_name,
    enabled: Boolean(r.enabled),
    name_custom: Boolean(r.name_custom),
  }))
}

function render(state: {
  rows: RosterRow[]
  cursor: number
  focus: Focus
  append: string
  dayStart: string
  dayEnd: string
  autoCopy: boolean
}): string {
  const lines: string[] = []
  lines.push(chalk.bold('tkt report'))
  lines.push('')

  if (state.focus === 'keys') {
    lines.push(chalk.cyan('快捷键区') + chalk.dim('  （↓ / Esc 回补充输入框）'))
    lines.push(chalk.dim('  ↑↓ / j k   移动'))
    lines.push(chalk.dim('  空格        开/关采集'))
    lines.push(chalk.dim('  e          改日报书写名（中文）'))
    lines.push(chalk.dim('  t          调整工时窗'))
    lines.push(chalk.dim('  c          开/关剪贴板（默认开）'))
    lines.push(chalk.dim('  Enter      开始生成日报'))
    lines.push(chalk.dim('  Ctrl+C     取消'))
    lines.push('')
    lines.push(
      chalk.dim('列：') +
        ` 勾选 │ ${chalk.bold('项目标识名(英文)')} │ ${chalk.bold('日报书写名(中文)')}`,
    )
    lines.push(
      `工时窗 ${state.dayStart} → ${state.dayEnd}` +
        chalk.dim('  · t 改') +
        '   剪贴板 ' +
        (state.autoCopy ? chalk.green('开') : chalk.yellow('关')) +
        chalk.dim('  · c 切换'),
    )
    lines.push(chalk.dim('─'.repeat(66)))

    if (!state.rows.length) {
      lines.push(chalk.yellow('（暂无仓库）'))
    }
    for (let i = 0; i < state.rows.length; i++) {
      const r = state.rows[i]!
      const on = state.cursor === i
      const mark = r.enabled ? chalk.green('[x]') : chalk.gray('[ ]')
      const proj = pad(projectLabel(r), 22)
      const name = pad(r.display_name || '(未命名)', 18)
      const tip = r.enabled ? '' : chalk.dim('  ← 不采集')
      const row = `${mark}  ${proj}  ${name}${tip}`
      lines.push(on ? chalk.inverse(` ${row} `) : `  ${row}`)
    }
    lines.push(chalk.dim('─'.repeat(66)))
    lines.push(
      chalk.dim('补充：') +
        (state.append ? ` ${state.append}` : chalk.dim(' （空）')),
    )
  } else {
    lines.push(chalk.dim('↑ 打开快捷键区（名单 / 书写名 / 工时 / 剪贴板）'))
    lines.push(chalk.dim('Enter 开始生成  ·  Ctrl+C 取消'))
    lines.push('')
    lines.push(chalk.bold('日报补充信息') + chalk.dim('（可传入仓库路径，可空）'))
    lines.push(chalk.cyan(`> ${state.append}█`))
  }

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
    message: `改书写名 · ${projectLabel(row)}`,
    placeholder: row.display_name || projectLabel(row),
    defaultValue: row.display_name || projectLabel(row),
    validate: (v) => ((v ?? '').trim() ? undefined : '不能为空'),
  })
  if (p.isCancel(next)) return
  row.display_name = String(next).trim()
  row.name_custom = true
}

/** @deprecated 兼容旧名；等同 promptReportInteractive */
export async function promptAppendOnly(repos: RepoEntry[]): Promise<RosterResult> {
  return promptReportInteractive(repos)
}

/** @deprecated 兼容旧名；等同 promptReportInteractive */
export async function promptRoster(repos: RepoEntry[]): Promise<RosterResult> {
  return promptReportInteractive(repos, { focusKeys: true })
}

/**
 * 默认焦点在补充输入框；opts.focusKeys 时（--roster）先进入快捷键区。
 */
export async function promptReportInteractive(
  repos: RepoEntry[],
  opts: { focusKeys?: boolean } = {},
): Promise<RosterResult> {
  const setting = loadSetting()
  const rows = toRows(repos)

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      repos: rows,
      append: '',
      dayStart: setting.day_start_max,
      dayEnd: setting.day_end_min,
      autoCopy: setting.auto_copy !== false,
    }
  }

  const state = {
    rows,
    cursor: Math.max(
      0,
      rows.findIndex((r) => r.enabled),
    ),
    focus: (opts.focusKeys ? 'keys' : 'append') as Focus,
    append: '',
    dayStart: setting.day_start_max || '09:00',
    dayEnd: setting.day_end_min || '21:00',
    autoCopy: setting.auto_copy !== false,
  }
  if (state.cursor < 0) state.cursor = 0

  const stdin = process.stdin
  let painted = 0
  const paint = () => {
    const text = render(state)
    if (painted > 0) process.stdout.write(`\x1b[${painted}A\x1b[0J`)
    process.stdout.write(text + '\n')
    painted = text.split('\n').length
  }

  const clearPaint = () => {
    if (painted > 0) {
      process.stdout.write(`\x1b[${painted}A\x1b[0J`)
      painted = 0
    }
  }

  const finish = (): RosterResult => {
    applyRoster(
      state.rows.map((r) => ({
        path: r.path,
        display_name: r.display_name,
        enabled: r.enabled,
        name_custom: r.name_custom,
      })),
    )
    const s = loadSetting()
    s.auto_copy = state.autoCopy
    writeSetting(s)
    const n = state.rows.filter((r) => r.enabled).length
    p.outro(
      `${n ? `采集 ${n} 仓` : '未勾选仓'} · ${state.dayStart}→${state.dayEnd}` +
        ` · 剪贴板${state.autoCopy ? '开' : '关'}` +
        (state.append ? ` · 补充已填` : ''),
    )
    return {
      repos: state.rows,
      append: state.append.trim(),
      dayStart: state.dayStart,
      dayEnd: state.dayEnd,
      autoCopy: state.autoCopy,
    }
  }

  while (true) {
    const wasRaw = enterRaw(stdin)
    paint()

    let goEdit = false
    let goHours = false
    let done = false
    let cancelled = false

    loop: while (true) {
      const key = await readRawKey(stdin)

      if (key === '\u0003') {
        cancelled = true
        break loop
      }

      // 方向键
      if (key.startsWith('\u001b')) {
        if (key === '\u001b') {
          if (state.focus === 'keys') {
            state.focus = 'append'
            paint()
            continue
          }
          cancelled = true
          break loop
        }
        const up = key.includes('A')
        const down = key.includes('B')
        if (state.focus === 'append') {
          if (up) {
            state.focus = 'keys'
            paint()
          }
          continue
        }
        // keys
        if (up && state.cursor > 0) state.cursor--
        if (down) {
          if (state.cursor < Math.max(0, state.rows.length - 1)) state.cursor++
          else {
            state.focus = 'append'
            paint()
            continue
          }
        }
        paint()
        continue
      }

      if (key === '\r' || key === '\n') {
        done = true
        break loop
      }

      if (state.focus === 'append') {
        if (key === '\u007f' || key === '\b') {
          state.append = state.append.slice(0, -1)
          paint()
          continue
        }
        // 可打印（含中文组合后的字符）
        if (key.length >= 1 && key !== '\t' && !key.startsWith('\u001b')) {
          if (key === '\t') continue
          state.append += key
          paint()
        }
        continue
      }

      // keys focus
      if (key === ' ' && state.rows[state.cursor]) {
        state.rows[state.cursor]!.enabled = !state.rows[state.cursor]!.enabled
        paint()
        continue
      }
      if ((key === 'e' || key === 'E') && state.rows[state.cursor]) {
        goEdit = true
        break loop
      }
      if (key === 't' || key === 'T') {
        goHours = true
        break loop
      }
      if (key === 'c' || key === 'C') {
        state.autoCopy = !state.autoCopy
        paint()
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
      if (key === 'j' && state.cursor >= state.rows.length - 1) {
        state.focus = 'append'
        paint()
        continue
      }
    }

    leaveRaw(stdin, wasRaw)
    clearPaint()

    if (cancelled) {
      p.cancel('已取消')
      process.exit(0)
    }
    if (done) return finish()

    if (goEdit) {
      const row = state.rows[state.cursor]
      if (row) await jumpEditName(row)
      state.focus = 'keys'
      continue
    }
    if (goHours) {
      const win = await promptWorkWindow({
        dayStart: state.dayStart,
        dayEnd: state.dayEnd,
      })
      state.dayStart = win.dayStart
      state.dayEnd = win.dayEnd
      state.focus = 'keys'
      continue
    }
  }
}
