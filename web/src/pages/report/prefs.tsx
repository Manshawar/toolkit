import { useEffect, useState } from 'preact/hooks'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import type { ReportSettingView } from '@web/pages/report/types'

export function ReportPrefsPage(_props: { path?: string }) {
  const [setting, setSetting] = useState<ReportSettingView | null>(null)
  const [role, setRole] = useState('')
  const [autoCopy, setAutoCopy] = useState(true)
  const [showRoster, setShowRoster] = useState(true)
  const [dayStart, setDayStart] = useState('09:00')
  const [dayEnd, setDayEnd] = useState('21:00')
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const s = await fetchJson<ReportSettingView>('/api/report/setting')
      setSetting(s)
      setRole(s.role || '')
      setAutoCopy(s.auto_copy)
      setShowRoster(s.show_roster)
      setDayStart(s.day_start_max || '09:00')
      setDayEnd(s.day_end_min || '21:00')
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
          day_start_max: dayStart,
          day_end_min: dayEnd,
        }),
      })
      setSetting(data)
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
          <div class="space-y-1.5">
            <Label>上班</Label>
            <Input
              value={dayStart}
              onInput={(e) => setDayStart((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label>下班</Label>
            <Input
              value={dayEnd}
              onInput={(e) => setDayEnd((e.target as HTMLInputElement).value)}
            />
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
