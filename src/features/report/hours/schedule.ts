/**
 * 按星期工时窗（纯函数，无 I/O）
 */
import {
  DEFAULT_WORK_SCHEDULE,
  WEEKDAY_KEYS,
  type DaySchedule,
  type ReportSetting,
  type WeekdayKey,
  type WorkSchedule,
} from '../types'

export const DAY_FLOOR = '09:00'
export const DAY_CEILING = '22:00'

const TIME_RE = /^\d{1,2}:\d{2}$/

/** JS getDay(): 0=日 … 6=六 → WeekdayKey */
const GETDAY_TO_KEY: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  mon: '周一',
  tue: '周二',
  wed: '周三',
  thu: '周四',
  fri: '周五',
  sat: '周六',
  sun: '周日',
}

export function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10))
  return (h || 0) * 60 + (m || 0)
}

export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 规范化 HH:MM（0–23:59） */
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

/** @deprecated */
export function clampHm(hm: string, _floor: string, _ceiling: string): string {
  return normalizeHm(hm, _floor)
}

export function hoursBetween(startHm: string, endHm: string): number {
  const mins = Math.max(0, parseHm(endHm) - parseHm(startHm))
  return Math.round((mins / 60) * 2) / 2
}

export function maxDayHours(dayStart: string, dayEnd: string): number {
  const start = normalizeHm(dayStart, DAY_FLOOR)
  const end = normalizeHm(dayEnd, '21:00')
  if (parseHm(end) <= parseHm(start)) return 0.5
  return Math.max(0.5, hoursBetween(start, end))
}

export function weekdayKeyFromDate(date: string | Date): WeekdayKey {
  const d =
    typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date
  return GETDAY_TO_KEY[d.getDay()] || 'mon'
}

function cloneSchedule(src: WorkSchedule = DEFAULT_WORK_SCHEDULE): WorkSchedule {
  return structuredClone(src)
}

/** 补齐 / 规范化 work_schedule；缺项用默认，并可叠旧全局窗 */
export function ensureWorkSchedule(
  raw: Partial<WorkSchedule> | null | undefined,
  legacy?: { start?: string; end?: string },
): WorkSchedule {
  const base = cloneSchedule()
  const hasRaw = raw && typeof raw === 'object' && WEEKDAY_KEYS.some((k) => raw[k])
  const legacyStart = legacy?.start ? normalizeHm(legacy.start, DAY_FLOOR) : null
  const legacyEnd = legacy?.end ? normalizeHm(legacy.end, '21:00') : null

  for (const key of WEEKDAY_KEYS) {
    const row = raw?.[key]
    const def = base[key]
    if (!row || typeof row !== 'object') {
      if (!hasRaw && legacyStart && key !== 'sun') def.start = legacyStart
      if (!hasRaw && legacyEnd && key !== 'sun') {
        if (key === 'fri' || key === 'sat') {
          // 旧全局默认 21:00/20:30 → 周五六用新默认 18:30；自定义 end 则沿用
          if (legacyEnd !== '21:00' && legacyEnd !== '20:30') def.end = legacyEnd
        } else {
          def.end = legacyEnd
        }
      }
      continue
    }
    def.enabled = typeof row.enabled === 'boolean' ? row.enabled : def.enabled
    def.start = normalizeHm(row.start, def.start)
    def.end = normalizeHm(row.end, def.end)
  }
  return base
}

export function dayScheduleOf(
  setting: Pick<ReportSetting, 'work_schedule' | 'day_start_max' | 'day_end_min'>,
  date: string,
): DaySchedule & { weekday: WeekdayKey } {
  const weekday = weekdayKeyFromDate(date)
  const schedule = ensureWorkSchedule(setting.work_schedule, {
    start: setting.day_start_max,
    end: setting.day_end_min,
  })
  const day = schedule[weekday]
  return {
    weekday,
    enabled: day.enabled,
    start: normalizeHm(day.start, DAY_FLOOR),
    end: normalizeHm(day.end, day.end || '21:00'),
  }
}

export function resolveWorkWindow(
  setting: Pick<ReportSetting, 'work_schedule' | 'day_start_max' | 'day_end_min'>,
  date: string,
  override?: { dayStart?: string; dayEnd?: string },
): { dayStart: string; dayEnd: string; enabled: boolean; weekday: WeekdayKey } {
  const day = dayScheduleOf(setting, date)
  const dayStart = normalizeHm(override?.dayStart || day.start, day.start)
  const dayEnd = normalizeHm(override?.dayEnd || day.end, day.end)
  return { dayStart, dayEnd, enabled: day.enabled, weekday: day.weekday }
}

export function applyDayWindow(
  setting: ReportSetting,
  weekday: WeekdayKey,
  patch: Partial<DaySchedule>,
): void {
  setting.work_schedule = ensureWorkSchedule(setting.work_schedule, {
    start: setting.day_start_max,
    end: setting.day_end_min,
  })
  const cur = setting.work_schedule[weekday]
  if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled
  if (typeof patch.start === 'string') cur.start = normalizeHm(patch.start, cur.start)
  if (typeof patch.end === 'string') cur.end = normalizeHm(patch.end, cur.end)
  setting.day_start_max = cur.start
  setting.day_end_min = cur.end
}

/** 整表写回并同步旧字段（用周一时间做兼容字段） */
export function applyWorkSchedule(setting: ReportSetting, next: WorkSchedule): void {
  setting.work_schedule = ensureWorkSchedule(next)
  setting.day_start_max = setting.work_schedule.mon.start
  setting.day_end_min = setting.work_schedule.mon.end
}
