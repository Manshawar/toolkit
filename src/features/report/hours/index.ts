/**
 * 工时窗：交互调整（先选星期 → 再改时间）
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { DEFAULT_WORK_SCHEDULE, WEEKDAY_KEYS, type WeekdayKey } from '../types'
import { loadSetting, writeSetting } from '../setting'
import {
  DAY_FLOOR,
  WEEKDAY_LABELS,
  applyDayWindow,
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

function printDefaultsBanner(): void {
  console.log('')
  console.log(chalk.cyan('工时窗（按星期配置；你改的时间优先）'))
  console.log(chalk.dim('  默认：'))
  console.log(chalk.dim(`    周一–周四  ${DAY_FLOOR} → 21:00`))
  console.log(chalk.dim('    周五、周六  09:00 → 18:30'))
  console.log(chalk.dim('    周日        默认不选（可加班改时间）'))
}

/**
 * 先选星期 → 再改上下班。调整后写回该星期；目标工时完全以该窗为准。
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

  if (!process.stdin.isTTY) {
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

  printDefaultsBanner()

  const weekday = (await p.select({
    message: '改哪一天？',
    options: WEEKDAY_KEYS.map((key) => {
      const row = schedule[key]
      const def = DEFAULT_WORK_SCHEDULE[key]
      const hours = maxDayHours(row.start, row.end)
      const mark = row.enabled ? '' : chalk.dim(' · 未选')
      return {
        value: key,
        label: `${WEEKDAY_LABELS[key]}  ${row.start} → ${row.end}（${hours}h）${mark}`,
        hint: key === today.weekday ? '今天' : `默认 ${def.start}→${def.end}`,
      }
    }),
    initialValue: today.weekday,
  })) as WeekdayKey | symbol
  if (p.isCancel(weekday)) {
    p.cancel('已取消')
    process.exit(0)
  }

  const row = schedule[weekday]
  let dayStart = normalizeHm(opts.dayStart && weekday === today.weekday ? opts.dayStart : row.start, row.start)
  let dayEnd = normalizeHm(opts.dayEnd && weekday === today.weekday ? opts.dayEnd : row.end, row.end)
  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    dayEnd = normalizeHm(DEFAULT_WORK_SCHEDULE[weekday].end)
  }

  const label = WEEKDAY_LABELS[weekday]
  if (!row.enabled) {
    console.log(chalk.yellow(`  ${label} 当前未勾选工作日，仍可改时间（加班可用）`))
  }

  const action = await p.select({
    message: `${label} 当前 ${dayStart} → ${dayEnd}（${maxDayHours(dayStart, dayEnd)}h）`,
    options: [
      {
        value: 'keep',
        label: '用当前时间',
        hint: `${dayStart} → ${dayEnd} · ${maxDayHours(dayStart, dayEnd)}h`,
      },
      { value: 'end', label: '改下班时间' },
      { value: 'start', label: '改上班时间' },
      { value: 'both', label: '上下班都改' },
      ...(row.enabled
        ? [{ value: 'disable', label: '取消勾选这一天', hint: '仍保留时间，仅标记非工作日' }]
        : [{ value: 'enable', label: '勾选为工作日' }]),
    ],
    initialValue: 'keep',
  })
  abort(action)

  if (action === 'disable' || action === 'enable') {
    applyDayWindow(setting, weekday, {
      enabled: action === 'enable',
      start: dayStart,
      end: dayEnd,
    })
    writeSetting(setting)
    console.log(
      chalk.green(
        action === 'enable'
          ? `→ ${label} 已勾选为工作日（${dayStart} → ${dayEnd}）`
          : `→ ${label} 已取消勾选（时间仍为 ${dayStart} → ${dayEnd}）`,
      ),
    )
    const again = resolveWorkWindow(loadSetting(), date)
    return {
      dayStart: again.dayStart,
      dayEnd: again.dayEnd,
      maxHours: maxDayHours(again.dayStart, again.dayEnd),
      weekday: again.weekday,
    }
  }

  if (action === 'start' || action === 'both') {
    dayStart = await askClock(`${label} 上班`, dayStart, START_PRESETS)
  }
  if (action === 'end' || action === 'both') {
    dayEnd = await askClock(`${label} 下班`, dayEnd, END_PRESETS)
  }

  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    console.log(chalk.yellow('下班须晚于上班，请重新设下班时间'))
    dayEnd = await askClock(`${label} 下班`, dayEnd, END_PRESETS)
    if (parseHm(dayEnd) <= parseHm(dayStart)) {
      dayEnd = formatHm(Math.min(23 * 60 + 59, parseHm(dayStart) + 8 * 60))
      console.log(chalk.yellow(`仍无效，已临时设为 ${dayStart} → ${dayEnd}`))
    }
  }

  applyDayWindow(setting, weekday, { start: dayStart, end: dayEnd })
  writeSetting(setting)

  const maxHours = maxDayHours(dayStart, dayEnd)
  console.log(chalk.green(`→ ${label} ${dayStart} → ${dayEnd}（目标 ${maxHours}h）`))

  // 本次日报仍用「今天」的窗；刚改的若是别的星期，只持久化不覆盖本次
  if (weekday !== today.weekday) {
    const again = resolveWorkWindow(loadSetting(), date)
    return {
      dayStart: again.dayStart,
      dayEnd: again.dayEnd,
      maxHours: maxDayHours(again.dayStart, again.dayEnd),
      weekday: again.weekday,
    }
  }
  return { dayStart, dayEnd, maxHours, weekday }
}
