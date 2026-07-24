/**
 * Report API：配置 + 归档统计
 * 挂载 /api/report
 */
import { Hono } from 'hono'
import {
  ROLES,
  WEEKDAY_KEYS,
  type ReportSetting,
  type RepoEntry,
  type WorkSchedule,
} from './types'
import {
  applyRoster,
  loadSetting,
  settingPath,
  writeSetting,
  isoNow,
} from './setting'
import { listHistory, loadHistory, summarizeHistory } from './history'
import { applyWorkSchedule, ensureWorkSchedule, normalizeHm } from './hours'
import { generateReportUi, ensureRepoOnRoster } from './generate'
import { halfHour, saveHistory, formatDaily } from './deliver'
import type { ReportRecord } from './types'

function settingView(s: ReportSetting) {
  const work_schedule = ensureWorkSchedule(s.work_schedule, {
    start: s.day_start_max,
    end: s.day_end_min,
  })
  return {
    path: settingPath(),
    roles: [...ROLES],
    role: s.role,
    auto_copy: s.auto_copy !== false,
    show_roster: s.show_roster !== false,
    git_user_email: s.git_user_email || '',
    day_start_max: s.day_start_max,
    day_end_min: s.day_end_min,
    work_schedule,
    repositories: s.repositories.map((r) => ({
      path: r.path,
      alias: r.alias,
      display_name: r.display_name,
      git_remote: r.git_remote,
      name_custom: !!r.name_custom,
      enabled: !!r.enabled,
      last_used_at: r.last_used_at,
    })),
  }
}

function fail(c: { json: (body: unknown, status?: number) => Response }, e: unknown, status = 500) {
  const error = e instanceof Error ? e.message : String(e)
  console.error('[api/report]', error)
  return c.json({ error }, status)
}

export function createReportApiRoutes(): Hono {
  const app = new Hono()

  app.get('/', (c) =>
    c.json({
      ok: true,
      endpoints: [
        'GET /api/report/setting',
        'POST /api/report/setting',
        'GET /api/report/stats',
        'GET /api/report/history',
        'GET /api/report/history/:date',
        'PUT /api/report/history/:date',
        'POST /api/report/generate',
        'POST /api/report/roster/add',
      ],
    }),
  )

  app.get('/setting', (c) => {
    try {
      return c.json(settingView(loadSetting()))
    } catch (e) {
      return fail(c, e)
    }
  })

  app.post('/setting', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        role?: string
        auto_copy?: boolean
        show_roster?: boolean
        day_start_max?: string
        day_end_min?: string
        work_schedule?: Partial<WorkSchedule>
        repositories?: Array<{
          path: string
          display_name?: string
          enabled?: boolean
          name_custom?: boolean
        }>
      }

      const s = loadSetting()

      if (typeof body.role === 'string') {
        const role = body.role.trim()
        if (role && !(ROLES as readonly string[]).includes(role)) {
          return c.json({ error: `角色须为：${ROLES.join(' / ')}` }, 400)
        }
        s.role = role
      }
      if (typeof body.auto_copy === 'boolean') s.auto_copy = body.auto_copy
      if (typeof body.show_roster === 'boolean') s.show_roster = body.show_roster

      if (body.work_schedule && typeof body.work_schedule === 'object') {
        const merged = ensureWorkSchedule(s.work_schedule, {
          start: s.day_start_max,
          end: s.day_end_min,
        })
        for (const key of WEEKDAY_KEYS) {
          const row = body.work_schedule[key]
          if (!row || typeof row !== 'object') continue
          if (typeof row.enabled === 'boolean') merged[key].enabled = row.enabled
          if (typeof row.start === 'string') {
            merged[key].start = normalizeHm(row.start, merged[key].start)
          }
          if (typeof row.end === 'string') {
            merged[key].end = normalizeHm(row.end, merged[key].end)
          }
        }
        applyWorkSchedule(s, merged)
      } else {
        // 兼容旧客户端：只改全局上下班 → 写到周一–周六
        if (typeof body.day_start_max === 'string' || typeof body.day_end_min === 'string') {
          const schedule = ensureWorkSchedule(s.work_schedule, {
            start: s.day_start_max,
            end: s.day_end_min,
          })
          const start =
            typeof body.day_start_max === 'string'
              ? normalizeHm(body.day_start_max, schedule.mon.start)
              : null
          const end =
            typeof body.day_end_min === 'string'
              ? normalizeHm(body.day_end_min, schedule.mon.end)
              : null
          for (const key of WEEKDAY_KEYS) {
            if (key === 'sun') continue
            if (start) schedule[key].start = start
            if (end) schedule[key].end = end
          }
          applyWorkSchedule(s, schedule)
        }
      }

      writeSetting(s)

      if (Array.isArray(body.repositories) && body.repositories.length) {
        applyRoster(
          body.repositories.map((r) => {
            const cur = s.repositories.find((x: RepoEntry) => x.path === r.path)
            return {
              path: r.path,
              display_name:
                typeof r.display_name === 'string'
                  ? r.display_name
                  : cur?.display_name || '',
              enabled: typeof r.enabled === 'boolean' ? r.enabled : !!cur?.enabled,
              name_custom:
                typeof r.name_custom === 'boolean'
                  ? r.name_custom
                  : typeof r.display_name === 'string'
                    ? true
                    : cur?.name_custom,
            }
          }),
        )
      }

      return c.json({ ok: true, ...settingView(loadSetting()) })
    } catch (e) {
      return fail(c, e, 400)
    }
  })

  app.get('/stats', (c) => {
    try {
      const seriesDays = parseInt(c.req.query('days') || '30', 10) || 30
      const records = listHistory()
      return c.json(summarizeHistory(records, { seriesDays, recentLimit: 20 }))
    } catch (e) {
      return fail(c, e)
    }
  })

  app.get('/history', (c) => {
    try {
      const limit = Math.min(90, Math.max(1, parseInt(c.req.query('limit') || '60', 10) || 60))
      return c.json({ records: listHistory().slice(0, limit) })
    } catch (e) {
      return fail(c, e)
    }
  })

  app.get('/history/:date', (c) => {
    try {
      const date = c.req.param('date')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return c.json({ error: '日期格式 YYYY-MM-DD' }, 400)
      }
      const rec = loadHistory(date)
      if (!rec) return c.json({ error: '无归档' }, 404)
      return c.json(rec)
    } catch (e) {
      return fail(c, e)
    }
  })

  app.put('/history/:date', async (c) => {
    try {
      const date = c.req.param('date')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return c.json({ error: '日期格式 YYYY-MM-DD' }, 400)
      }
      const body = (await c.req.json().catch(() => ({}))) as Partial<ReportRecord>
      const prev = loadHistory(date)
      if (!prev && !body.items) {
        return c.json({ error: '无归档可改' }, 404)
      }

      const items = Array.isArray(body.items)
        ? body.items.map((it) => ({
            project: String(it.project || '通用').trim() || '通用',
            text: String(it.text || '').trim(),
            hours: halfHour(Number(it.hours) || 0.5),
          }))
        : prev!.items

      if (!items.length) return c.json({ error: '至少一条任务' }, 400)
      if (items.some((it) => !it.text)) return c.json({ error: '任务描述不能为空' }, 400)

      const totalHours = items.reduce((s, it) => s + it.hours, 0)
      const record: ReportRecord = {
        date,
        role: typeof body.role === 'string' ? body.role : prev?.role || '',
        sheetTime:
          typeof body.sheetTime === 'string' && body.sheetTime.trim()
            ? body.sheetTime.trim()
            : prev?.sheetTime || items.map((i) => i.text).join('；').slice(0, 80),
        items,
        totalHours: Math.round(totalHours * 10) / 10,
        targetHours:
          typeof body.targetHours === 'number'
            ? body.targetHours
            : prev?.targetHours || totalHours,
        sessionHours:
          typeof body.sessionHours === 'number'
            ? body.sessionHours
            : prev?.sessionHours || totalHours,
        commitCount:
          typeof body.commitCount === 'number'
            ? body.commitCount
            : prev?.commitCount || 0,
        emittedAt: isoNow(),
      }
      const file = saveHistory(record)
      return c.json({
        ok: true,
        saved: file,
        record,
        dailyText: formatDaily({
          items: record.items,
          sheetTime: record.sheetTime,
          displayNames: [],
        }),
      })
    } catch (e) {
      return fail(c, e, 400)
    }
  })

  app.post('/roster/add', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { path?: string }
      if (typeof body.path !== 'string' || !body.path.trim()) {
        return c.json({ error: 'path 必填' }, 400)
      }
      const abs = ensureRepoOnRoster(body.path)
      return c.json({ ok: true, path: abs, ...settingView(loadSetting()) })
    } catch (e) {
      return fail(c, e, 400)
    }
  })

  app.post('/generate', async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as {
        date?: string
        paths?: string[]
        path?: string
        append?: string
        role?: string
        clipboard?: boolean
      }

      const paths = [
        ...(Array.isArray(body.paths) ? body.paths : []),
        ...(typeof body.path === 'string' && body.path.trim() ? [body.path.trim()] : []),
      ]

      const result = await generateReportUi({
        date: typeof body.date === 'string' ? body.date : undefined,
        paths: paths.length ? paths : undefined,
        append: typeof body.append === 'string' ? body.append : undefined,
        role: typeof body.role === 'string' ? body.role : undefined,
        clipboard: body.clipboard === true,
      })
      return c.json({ ok: true, ...result })
    } catch (e) {
      return fail(c, e, 400)
    }
  })

  return app
}

export function mountReportRoutes(app: Hono): void {
  app.route('/api/report', createReportApiRoutes())
}
