import { useEffect, useMemo, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import type { ReportSettingView, RepoRow } from '@web/pages/report/types'

export function ReportGeneratePage(_props: { path?: string }) {
  const [repos, setRepos] = useState<RepoRow[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [extraPath, setExtraPath] = useState('')
  const [append, setAppend] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  const picked = useMemo(
    () => repos.filter((r) => selected[r.path]).map((r) => r.path),
    [repos, selected],
  )

  useEffect(() => {
    void fetchJson<ReportSettingView>('/api/report/setting')
      .then((s) => {
        setRepos(s.repositories || [])
        setSelected(
          Object.fromEntries((s.repositories || []).map((r) => [r.path, !!r.enabled])),
        )
      })
      .catch((e) => {
        setOk(false)
        setMsg(e instanceof Error ? e.message : String(e))
      })
  }, [])

  async function generate() {
    setBusy(true)
    setOk(false)
    setMsg('生成中…（读 commit + AI，可能要半分钟）')
    try {
      const paths = [...picked]
      if (extraPath.trim()) paths.push(extraPath.trim())
      const data = await fetchJson<{
        record: { date: string }
        gather?: { commitCount: number; repos: number }
      }>('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: paths.length ? paths : undefined,
          append: append.trim() || undefined,
        }),
      })
      setOk(true)
      setMsg(
        `完成 · ${data.gather?.repos ?? 0} 仓 · ${data.gather?.commitCount ?? 0} commits`,
      )
      route(`/report/history/${data.record.date}`)
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ReportLayout path="/report/generate">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>生成今日日报</CardTitle>
            <p class="mt-1 text-sm font-normal text-muted">
              只扫名单里已有仓库，或粘贴本地路径；不自动搜 cwd。
            </p>
          </div>
          <Button disabled={busy} onClick={() => void generate()}>
            {busy ? '生成中…' : '生成并归档'}
          </Button>
        </CardHeader>

        {repos.length ? (
          <div class="mb-4 grid max-h-56 grid-cols-1 gap-1.5 overflow-auto sm:grid-cols-2">
            {repos.map((r) => (
              <label
                key={r.path}
                class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface/80"
              >
                <Checkbox
                  class="mt-0.5"
                  checked={!!selected[r.path]}
                  onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked
                    setSelected((s) => ({ ...s, [r.path]: on }))
                  }}
                />
                <span class="min-w-0">
                  <span class="font-medium">{r.display_name || r.alias}</span>
                  <span class="mt-0.5 block truncate font-mono text-[11px] text-muted">
                    {r.path}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p class="mb-3 text-sm text-muted">名单为空时，请在下方输入仓库路径，或先去「名单」添加。</p>
        )}

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="space-y-1.5">
            <Label>额外路径</Label>
            <Input
              value={extraPath}
              placeholder="/Users/me/proj"
              onInput={(e) => setExtraPath((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="space-y-1.5">
            <Label>附带杂事</Label>
            <Input
              value={append}
              placeholder="可选"
              onInput={(e) => setAppend((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        {msg ? (
          <p class={`mt-4 text-sm ${ok ? 'text-success' : busy ? 'text-muted' : 'text-destructive'}`}>
            {msg}
          </p>
        ) : null}
      </Card>
    </ReportLayout>
  )
}
