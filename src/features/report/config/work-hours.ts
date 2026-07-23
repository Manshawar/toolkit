/**
 * 工时窗：用户设定为准（调整后写回 setting，全日目标 = 该窗时长）。
 * 封顶 09:00→22:00；默认 09:00→21:00。多仓不累加。
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { loadSetting, writeSetting } from './setting'

/** 绝对最早上班 / 最晚下班（封顶） */
export const DAY_FLOOR = '09:00'
export const DAY_CEILING = '22:00'

const TIME_RE = /^\d{1,2}:\d{2}$/

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function clampHm(hm: string, floor: string, ceiling: string): string {
  const t = TIME_RE.test(hm.trim()) ? hm.trim() : floor
  const n = parseHm(t)
  return formatHm(Math.min(parseHm(ceiling), Math.max(parseHm(floor), n)))
}

/** 两时刻差（小时），半小时粒度 */
export function hoursBetween(startHm: string, endHm: string): number {
  const mins = Math.max(0, parseHm(endHm) - parseHm(startHm))
  return Math.round((mins / 60) * 2) / 2
}

/** 用户设定窗的目标工时（以调整时间为准） */
export function maxDayHours(dayStart: string, dayEnd: string): number {
  const start = clampHm(dayStart, DAY_FLOOR, DAY_CEILING)
  const end = clampHm(dayEnd, DAY_FLOOR, DAY_CEILING)
  if (parseHm(end) <= parseHm(start)) return 0.5
  return Math.min(13, Math.max(0.5, hoursBetween(start, end)))
}

function abort(v: unknown): asserts v is string {
  if (p.isCancel(v)) {
    p.cancel('已取消')
    process.exit(0)
  }
}

async function askClock(message: string, current: string, presets: string[]): Promise<string> {
  const options = [
    ...presets.map((t) => ({
      value: t,
      label: t,
      hint: t === DAY_FLOOR ? '封顶最早' : t === DAY_CEILING ? '封顶最晚' : undefined,
    })),
    { value: '__custom', label: '自定义…', hint: '手动输入 HH:MM' },
  ]
  const initial = presets.includes(current) ? current : '__custom'
  const picked = await p.select({
    message,
    options,
    initialValue: initial,
  })
  abort(picked)

  if (picked !== '__custom') return clampHm(picked, DAY_FLOOR, DAY_CEILING)

  const raw = await p.text({
    message: `${message}（HH:MM，范围 ${DAY_FLOOR}–${DAY_CEILING}）`,
    placeholder: current,
    defaultValue: current,
    validate: (v) => {
      const t = (v ?? '').trim()
      if (!TIME_RE.test(t)) return '格式须为 HH:MM，如 21:00'
      const n = parseHm(t)
      if (n < parseHm(DAY_FLOOR) || n > parseHm(DAY_CEILING)) {
        return `须在 ${DAY_FLOOR}–${DAY_CEILING} 之间`
      }
      return undefined
    },
  })
  abort(raw)
  return clampHm(String(raw), DAY_FLOOR, DAY_CEILING)
}

/**
 * 交互调整工时窗；调整后写回 setting，后续 gather / 目标工时一律以该窗为准。
 */
export async function promptWorkWindow(opts: {
  dayStart?: string
  dayEnd?: string
} = {}): Promise<{ dayStart: string; dayEnd: string; maxHours: number }> {
  const setting = loadSetting()
  let dayStart = clampHm(
    opts.dayStart || setting.day_start_max || DAY_FLOOR,
    DAY_FLOOR,
    DAY_CEILING,
  )
  let dayEnd = clampHm(
    opts.dayEnd || setting.day_end_min || '21:00',
    DAY_FLOOR,
    DAY_CEILING,
  )
  if (parseHm(dayEnd) <= parseHm(dayStart)) dayEnd = DAY_CEILING

  if (!process.stdin.isTTY) {
    return { dayStart, dayEnd, maxHours: maxDayHours(dayStart, dayEnd) }
  }

  console.log('')
  console.log(chalk.cyan('工时窗（调整后以你设的时间为准）'))
  console.log(
    chalk.dim(
      `  今日日报总工时 = 下班 − 上班；多仓不累加。封顶 ${DAY_FLOOR} → ${DAY_CEILING}`,
    ),
  )

  const action = await p.select({
    message: `当前 ${dayStart} → ${dayEnd}（${maxDayHours(dayStart, dayEnd)}h），要调整吗？`,
    options: [
      {
        value: 'keep',
        label: '用当前时间',
        hint: `${dayStart} → ${dayEnd} · ${maxDayHours(dayStart, dayEnd)}h`,
      },
      { value: 'end', label: '改下班时间' },
      { value: 'start', label: '改上班时间' },
      { value: 'both', label: '上下班都改' },
    ],
    initialValue: 'keep',
  })
  abort(action)

  if (action === 'start' || action === 'both') {
    dayStart = await askClock('上班时间', dayStart, ['09:00', '09:30', '10:00'])
  }
  if (action === 'end' || action === 'both') {
    dayEnd = await askClock('下班时间', dayEnd, ['20:30', '21:00', '21:30', '22:00'])
  }

  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    console.log(chalk.yellow(`下班须晚于上班，已把下班调到 ${DAY_CEILING}`))
    dayEnd = DAY_CEILING
  }

  setting.day_start_max = dayStart
  setting.day_end_min = dayEnd
  writeSetting(setting)

  const maxHours = maxDayHours(dayStart, dayEnd)
  console.log(chalk.green(`→ 以 ${dayStart} → ${dayEnd} 为准（目标 ${maxHours}h）`))
  return { dayStart, dayEnd, maxHours }
}
