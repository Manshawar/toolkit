/**
 * 工时窗：用户调整优先级最高，不受默认封顶限制。
 * 默认建议 09:00→21:00；目标工时 = 下班 − 上班（写多少用多少）。
 */
import * as p from '@clack/prompts'
import chalk from 'chalk'
import { loadSetting, writeSetting } from '../setting'

/** 仅作默认建议，不限制用户调整 */
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

/** 规范化 HH:MM（0–23:59），不按 09–22 封顶裁剪 */
export function normalizeHm(hm: string, fallback = '09:00'): string {
  const t = (hm || '').trim()
  if (!TIME_RE.test(t)) return fallback
  const [hs, ms] = t.split(':')
  const h = parseInt(hs!, 10)
  const m = parseInt(ms!, 10)
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return fallback
  }
  return formatHm(h * 60 + m)
}

/** @deprecated 保留给旧调用；用户窗请用 normalizeHm，勿再按封顶 clamp */
export function clampHm(hm: string, _floor: string, _ceiling: string): string {
  return normalizeHm(hm, _floor)
}

/** 两时刻差（小时），半小时粒度 */
export function hoursBetween(startHm: string, endHm: string): number {
  const mins = Math.max(0, parseHm(endHm) - parseHm(startHm))
  return Math.round((mins / 60) * 2) / 2
}

/** 以用户设定为准，不截 13h、不套 09–22 封顶 */
export function maxDayHours(dayStart: string, dayEnd: string): number {
  const start = normalizeHm(dayStart, DAY_FLOOR)
  const end = normalizeHm(dayEnd, '21:00')
  if (parseHm(end) <= parseHm(start)) return 0.5
  return Math.max(0.5, hoursBetween(start, end))
}

function abort(v: unknown): asserts v is string {
  if (p.isCancel(v)) {
    p.cancel('已取消')
    process.exit(0)
  }
}

async function askClock(message: string, current: string, presets: string[]): Promise<string> {
  const options = [
    ...presets.map((t) => ({ value: t, label: t })),
    { value: '__custom', label: '自定义…', hint: '任意 HH:MM，不受默认建议限制' },
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
    message: `${message}（HH:MM，你设多少用多少）`,
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

/**
 * 交互调整工时窗。调整后写回 setting；目标工时完全以该窗为准。
 */
export async function promptWorkWindow(opts: {
  dayStart?: string
  dayEnd?: string
} = {}): Promise<{ dayStart: string; dayEnd: string; maxHours: number }> {
  const setting = loadSetting()
  let dayStart = normalizeHm(opts.dayStart || setting.day_start_max || DAY_FLOOR, DAY_FLOOR)
  let dayEnd = normalizeHm(opts.dayEnd || setting.day_end_min || '21:00', '21:00')
  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    dayEnd = normalizeHm('21:00')
  }

  if (!process.stdin.isTTY) {
    return { dayStart, dayEnd, maxHours: maxDayHours(dayStart, dayEnd) }
  }

  console.log('')
  console.log(chalk.cyan('工时窗（你调整的时间优先级最高，不受默认封顶限制）'))
  console.log(
    chalk.dim(
      `  总工时 = 下班 − 上班；多仓不累加。默认建议 ${DAY_FLOOR}→21:00（可改成任意 HH:MM）`,
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
    dayStart = await askClock('上班时间', dayStart, ['08:30', '09:00', '09:30', '10:00'])
  }
  if (action === 'end' || action === 'both') {
    dayEnd = await askClock('下班时间', dayEnd, ['20:30', '21:00', '21:30', '22:00', '23:00'])
  }

  if (parseHm(dayEnd) <= parseHm(dayStart)) {
    console.log(chalk.yellow('下班须晚于上班，请重新设下班时间'))
    dayEnd = await askClock('下班时间', dayEnd, ['20:30', '21:00', '21:30', '22:00', '23:00'])
    if (parseHm(dayEnd) <= parseHm(dayStart)) {
      // 仍不合法：自动 +8h 兜底，避免卡死
      dayEnd = formatHm(Math.min(23 * 60 + 59, parseHm(dayStart) + 8 * 60))
      console.log(chalk.yellow(`仍无效，已临时设为 ${dayStart} → ${dayEnd}`))
    }
  }

  setting.day_start_max = dayStart
  setting.day_end_min = dayEnd
  writeSetting(setting)

  const maxHours = maxDayHours(dayStart, dayEnd)
  console.log(chalk.green(`→ 以你设的 ${dayStart} → ${dayEnd} 为准（目标 ${maxHours}h）`))
  return { dayStart, dayEnd, maxHours }
}
