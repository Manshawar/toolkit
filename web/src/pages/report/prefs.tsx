import { useEffect, useState } from 'preact/hooks'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  type DayScheduleView,
  type ReportSettingView,
  type WeekdayKey,
  type WorkScheduleView,
} from '@web/pages/report/types'

const EMPTY_SCHEDULE: WorkScheduleView = {
  mon: { enabled: true, start: '09:00', end: '21:00' },
  tue: { enabled: true, start: '09:00', end: '21:00' },
  wed: { enabled: true, start: '09:00', end: '21:00' },
  thu: { enabled: true, start: '09:00', end: '21:00' },
  fri: { enabled: true, start: '09:00', end: '18:30' },
  sat: { enabled: true, start: '09:00', end: '18:30' },
  sun: { enabled: false, start: '09:00', end: '18:30' },
}

function cloneSchedule(s: WorkScheduleView): WorkScheduleView {
  return structuredClone(s)
}

export function ReportPrefsPage(_props: { path?: string }) {
  const [setting, setSetting] = useState<ReportSettingView | null>(null)
  const [role, setRole] = useState('')
  const [autoCopy, setAutoCopy] = useState(true)
  const [showRoster, setShowRoster] = useState(true)
  const [schedule, setSchedule] = useState<WorkScheduleView>(cloneSchedule(EMPTY_SCHEDULE))
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  function patchDay(key: WeekdayKey, patch: Partial<DayScheduleView>) {
    setSchedule((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }))
  }

  async function load() {
    try {
      const s = await fetchJson<ReportSettingView>('/api/report/setting')
      setSetting(s)
      setRole(s.role || '')
      setAutoCopy(s.auto_copy)
      setShowRoster(s.show_roster)
      setSchedule(cloneSchedule(s.work_schedule || EMPTY_SCHEDULE))
      setOk(true)
      setMsg('')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function save() {
    setBusy(true)
    try {
      const data = await fetchJson<ReportSettingView>('/api/report/setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          auto_copy: autoCopy,
          show_roster: showRoster,
          work_schedule: schedule,
        }),
      })
      setSetting(data)
      setSchedule(cloneSchedule(data.work_schedule || schedule))
      setOk(true)
      setMsg(`已保存 → ${data.path}`)
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <ReportLayout path="/report/prefs">
      <Card>
        <CardHeader>
          <CardTitle>偏好</CardTitle>
          <Button disabled={busy} onClick={() => void save()}>
            保存
          </Button>
        </CardHeader>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label>角色</Label>
            <select
              class="h-10 w-full rounded-md border border-border bg-white px-3 text-sm"
              value={role}
              onChange={(e) => setRole((e.target as HTMLSelectElement).value)}
            >
              <option value="">未设置</option>
              {(setting?.roles || []).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div class="space-y-1.5">
            <Label>Git 邮箱</Label>
            <Input value={setting?.git_user_email || ''} disabled />
          </div>
        </div>

        <div class="mt-6 space-y-2">
          <div>
            <Label>工时偏好（按星期）</Label>
            <p class="mt-1 text-xs text-muted-foreground">
              默认：周一–周四 09:00→21:00；周五/周六 →18:30；周日不选。生成日报时按当日星期取窗。
            </p>
          </div>
          <div class="overflow-x-auto rounded-md border border-border">
            <table class="w-full min-w-[28rem] text-sm">
              <thead>
                <tr class="border-b border-border bg-surface/60 text-left text-muted-foreground">
                  <th class="px-3 py-2 font-medium">工作日</th>
                  <th class="px-3 py-2 font-medium">上班</th>
                  <th class="px-3 py-2 font-medium">下班</th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_KEYS.map((key) => {
                  const row = schedule[key]
                  return (
                    <tr key={key} class="border-b border-border/70 last:border-0">
                      <td class="px-3 py-2">
                        <label class="flex items-center gap-2">
                          <Checkbox
                            checked={row.enabled}
                            onChange={(e) =>
                              patchDay(key, {
                                enabled: (e.target as HTMLInputElement).checked,
                              })
                            }
                          />
                          <span class={row.enabled ? '' : 'text-muted-foreground'}>
                            {WEEKDAY_LABELS[key]}
                          </span>
                        </label>
                      </td>
                      <td class="px-3 py-2">
                        <Input
                          class="h-9"
                          type="time"
                          value={row.start}
                          onInput={(e) =>
                            patchDay(key, { start: (e.target as HTMLInputElement).value })
                          }
                        />
                      </td>
                      <td class="px-3 py-2">
                        <Input
                          class="h-9"
                          type="time"
                          value={row.end}
                          onInput={(e) =>
                            patchDay(key, { end: (e.target as HTMLInputElement).value })
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-5">
          <label class="flex items-center gap-2 text-sm">
            <Checkbox
              checked={autoCopy}
              onChange={(e) => setAutoCopy((e.target as HTMLInputElement).checked)}
            />
            CLI 生成后自动复制
          </label>
          <label class="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showRoster}
              onChange={(e) => setShowRoster((e.target as HTMLInputElement).checked)}
            />
            CLI 启动显示名单
          </label>
        </div>
        <p class={`mt-3 text-sm ${ok ? 'text-success' : 'text-destructive'}`}>{msg}</p>
      </Card>
    </ReportLayout>
  )
}
