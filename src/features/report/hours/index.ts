/**
 * 工时窗：raw 交互
 * 外层：↑↓ 移动 · 空格勾选 · Enter 改时间 · Esc 返回/退出
 * 内层：改上下班 · Esc 回星期列表
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import {
  DEFAULT_WORK_SCHEDULE,
  WEEKDAY_KEYS,
  type WeekdayKey,
  type WorkSchedule,
} from '../types'
import { loadSetting, writeSetting } from '../setting'
import {
  DAY_FLOOR,
  WEEKDAY_LABELS,
  applyWorkSchedule,
  ensureWorkSchedule,
  formatHm,
  maxDayHours,
  normalizeHm,
  parseHm,
  resolveWorkWindow,
} from './schedule'

export {
  DAY_CEILING,
  DAY_FLOOR,
  WEEKDAY_LABELS,
  applyDayWindow,
  applyWorkSchedule,
  clampHm,
  dayScheduleOf,
  ensureWorkSchedule,
  formatHm,
  hoursBetween,
  maxDayHours,
  normalizeHm,
  parseHm,
  resolveWorkWindow,
  weekdayKeyFromDate,
} from './schedule'

const TIME_RE = /^\d{1,2}:\d{2}$/
const START_PRESETS = ['08:30', '09:00', '09:30', '10:00']
const END_PRESETS = ['18:00', '18:30', '20:30', '21:00', '21:30', '22:00', '23:00']

function abort(v: unknown): asserts v is string {
  if (p.isCancel(v)) {
    p.cancel('已取消')
    process.exit(0)
  }
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

async function askClock(message: string, current: string, presets: string[]): Promise<string> {
  const options = [
    ...presets.map((t) => ({ value: t, label: t })),
    { value: '__custom', label: '自定义…', hint: '任意 HH:MM' },
  ]
  const initial = presets.includes(current) ? current : '__custom'
  const picked = await p.select({
    message,
    options,
    initialValue: initial,
  })
  abort(picked)

  if (picked !== '__custom') return normalizeHm(picked, current)

  const raw = await p.text({
    message: `${message}（HH:MM）`,
    placeholder: current,
    defaultValue: current,
    validate: (v) => {
      const t = (v ?? '').trim()
      if (!TIME_RE.test(t)) return '格式须为 HH:MM，如 08:30 / 23:00'
      const [hs, ms] = t.split(':')
      const h = parseInt(hs!, 10)
      const m = parseInt(ms!, 10)
      if (h < 0 || h > 23 || m < 0 || m > 59) return '小时 0–23，分钟 0–59'
      return undefined
    },
  })
  abort(raw)
  return normalizeHm(String(raw), current)
}

function ensureValidWindow(start: string, end: string, weekday: WeekdayKey): { start: string; end: string } {
  let dayStart = normalizeHm(start)
  let dayEnd = normalizeHm(end)
  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    dayEnd = normalizeHm(DEFAULT_WORK_SCHEDULE[weekday].end)
  }
  return { start: dayStart, end: dayEnd }
}

type Layer = 'days' | 'edit'
type EditAction = 'keep' | 'start' | 'end' | 'both'

function renderDays(opts: {
  schedule: WorkSchedule
  cursor: number
  today: WeekdayKey
}): string {
  const lines: string[] = []
  lines.push(chalk.bold('工时窗') + chalk.dim('  · 按星期'))
  lines.push('')
  lines.push(chalk.dim('默认：周一–四 09:00→21:00 · 五六 →18:30 · 周日不选'))
  lines.push(chalk.dim('↑↓ / j k  移动  ·  空格 勾选/取消  ·  Enter 改时间  ·  Esc 返回'))
  lines.push(chalk.dim('─'.repeat(56)))

  for (let i = 0; i < WEEKDAY_KEYS.length; i++) {
    const key = WEEKDAY_KEYS[i]!
    const row = opts.schedule[key]
    const hours = maxDayHours(row.start, row.end)
    const mark = row.enabled ? chalk.green('[x]') : chalk.gray('[ ]')
    const today = key === opts.today ? chalk.cyan(' 今天') : ''
    const off = row.enabled ? '' : chalk.dim(' · 未选')
    const text = `${mark}  ${WEEKDAY_LABELS[key]}  ${row.start} → ${row.end}（${hours}h）${off}${today}`
    lines.push(i === opts.cursor ? chalk.inverse(` ${text} `) : `  ${text}`)
  }

  lines.push(chalk.dim('─'.repeat(56)))
  lines.push(chalk.dim(`建议 ${DAY_FLOOR}→21:00 / 五六 18:30`))
  return lines.join('\n')
}

function renderEdit(opts: {
  weekday: WeekdayKey
  start: string
  end: string
  enabled: boolean
  cursor: number
}): string {
  const label = WEEKDAY_LABELS[opts.weekday]
  const hours = maxDayHours(opts.start, opts.end)
  const actions: Array<{ id: EditAction; label: string; hint?: string }> = [
    { id: 'keep', label: '用当前时间', hint: `${opts.start} → ${opts.end} · ${hours}h` },
    { id: 'start', label: '改上班时间' },
    { id: 'end', label: '改下班时间' },
    { id: 'both', label: '上下班都改' },
  ]

  const lines: string[] = []
  lines.push(chalk.bold(`${label} · 改时间`))
  lines.push('')
  lines.push(
    chalk.dim('当前 ') +
      `${opts.start} → ${opts.end}（${hours}h）` +
      (opts.enabled ? '' : chalk.yellow(' · 未勾选工作日')),
  )
  lines.push(chalk.dim('↑↓ 移动  ·  Enter 确认  ·  Esc 回星期列表'))
  lines.push(chalk.dim('─'.repeat(56)))

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!
    const text = a.hint ? `${a.label}  ${chalk.dim(a.hint)}` : a.label
    lines.push(i === opts.cursor ? chalk.inverse(` ${text} `) : `  ${text}`)
  }

  lines.push(chalk.dim('─'.repeat(56)))
  return lines.join('\n')
}

/**
 * 外层空格勾选星期；Esc 回上层；最外层 Esc 退出本面板（返回调用方）。
 */
export async function promptWorkWindow(opts: {
  date?: string
  dayStart?: string
  dayEnd?: string
} = {}): Promise<{ dayStart: string; dayEnd: string; maxHours: number; weekday: WeekdayKey }> {
  const setting = loadSetting()
  const date = opts.date || new Date().toISOString().slice(0, 10)
  const today = resolveWorkWindow(setting, date, {
    dayStart: opts.dayStart,
    dayEnd: opts.dayEnd,
  })

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {
      dayStart: today.dayStart,
      dayEnd: today.dayEnd,
      maxHours: maxDayHours(today.dayStart, today.dayEnd),
      weekday: today.weekday,
    }
  }

  const schedule = ensureWorkSchedule(setting.work_schedule, {
    start: setting.day_start_max,
    end: setting.day_end_min,
  })

  const persist = () => {
    applyWorkSchedule(setting, schedule)
    writeSetting(setting)
  }

  const finish = () => {
    persist()
    const again = resolveWorkWindow(loadSetting(), date)
    return {
      dayStart: again.dayStart,
      dayEnd: again.dayEnd,
      maxHours: maxDayHours(again.dayStart, again.dayEnd),
      weekday: again.weekday,
    }
  }

  let layer: Layer = 'days'
  let dayCursor = Math.max(0, WEEKDAY_KEYS.indexOf(today.weekday))
  let editCursor = 0
  let editWeekday: WeekdayKey = today.weekday

  const stdin = process.stdin
  let painted = 0

  const paint = () => {
    const text =
      layer === 'days'
        ? renderDays({ schedule, cursor: dayCursor, today: today.weekday })
        : renderEdit({
            weekday: editWeekday,
            start: schedule[editWeekday].start,
            end: schedule[editWeekday].end,
            enabled: schedule[editWeekday].enabled,
            cursor: editCursor,
          })
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

  while (true) {
    const wasRaw = enterRaw(stdin)
    paint()

    let editAction: EditAction | null = null
    let cancelled = false
    let done = false

    loop: while (true) {
      const key = await readRawKey(stdin)

      if (key === '\u0003') {
        cancelled = true
        break loop
      }

      // Esc / 方向键
      if (key.startsWith('\u001b')) {
        if (key === '\u001b') {
          if (layer === 'edit') {
            layer = 'days'
            paint()
            continue
          }
          done = true
          break loop
        }
        const up = key.includes('A')
        const down = key.includes('B')
        if (layer === 'days') {
          if (up && dayCursor > 0) dayCursor--
          if (down && dayCursor < WEEKDAY_KEYS.length - 1) dayCursor++
        } else {
          if (up && editCursor > 0) editCursor--
          if (down && editCursor < 3) editCursor++
        }
        paint()
        continue
      }

      if (key === 'k') {
        if (layer === 'days' && dayCursor > 0) dayCursor--
        if (layer === 'edit' && editCursor > 0) editCursor--
        paint()
        continue
      }
      if (key === 'j') {
        if (layer === 'days' && dayCursor < WEEKDAY_KEYS.length - 1) dayCursor++
        if (layer === 'edit' && editCursor < 3) editCursor++
        paint()
        continue
      }

      if (layer === 'days') {
        if (key === ' ') {
          const wk = WEEKDAY_KEYS[dayCursor]!
          schedule[wk].enabled = !schedule[wk].enabled
          persist()
          paint()
          continue
        }
        if (key === '\r' || key === '\n') {
          editWeekday = WEEKDAY_KEYS[dayCursor]!
          editCursor = 0
          layer = 'edit'
          paint()
          continue
        }
        continue
      }

      // edit layer
      if (key === '\r' || key === '\n') {
        const actions: EditAction[] = ['keep', 'start', 'end', 'both']
        editAction = actions[editCursor]!
        break loop
      }
    }

    leaveRaw(stdin, wasRaw)
    clearPaint()

    if (cancelled) {
      p.cancel('已取消')
      process.exit(0)
    }
    if (done) {
      const result = finish()
      console.log(
        chalk.green(
          `→ 工时窗已保存 · 本次 ${WEEKDAY_LABELS[result.weekday]} ${result.dayStart}→${result.dayEnd}（${result.maxHours}h）`,
        ),
      )
      return result
    }

    if (!editAction || editAction === 'keep') {
      layer = 'days'
      continue
    }

    const row = schedule[editWeekday]
    let { start, end } = ensureValidWindow(row.start, row.end, editWeekday)
    const label = WEEKDAY_LABELS[editWeekday]

    if (editAction === 'start' || editAction === 'both') {
      start = await askClock(`${label} 上班`, start, START_PRESETS)
    }
    if (editAction === 'end' || editAction === 'both') {
      end = await askClock(`${label} 下班`, end, END_PRESETS)
    }

    if (parseHm(end) <= parseHm(start)) {
      console.log(chalk.yellow('下班须晚于上班，请重新设下班时间'))
      end = await askClock(`${label} 下班`, end, END_PRESETS)
      if (parseHm(end) <= parseHm(start)) {
        end = formatHm(Math.min(23 * 60 + 59, parseHm(start) + 8 * 60))
        console.log(chalk.yellow(`仍无效，已临时设为 ${start} → ${end}`))
      }
    }

    row.start = start
    row.end = end
    persist()
    console.log(chalk.green(`→ ${label} ${start} → ${end}（${maxDayHours(start, end)}h）`))
    layer = 'days'
  }
}
