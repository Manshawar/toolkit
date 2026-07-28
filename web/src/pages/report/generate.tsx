import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import { formatDaily } from '@web/pages/report/daily-text'
import type { ReportRecord, ReportSettingView, RepoRow } from '@web/pages/report/types'

export function ReportGeneratePage() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<RepoRow[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [extraPath, setExtraPath] = useState('')
  const [append, setAppend] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [generatedDate, setGeneratedDate] = useState('')
  const [dailyText, setDailyText] = useState('')
  const [copyMsg, setCopyMsg] = useState('')

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
      // 留在本页：拉归档记录，下面直接展示工时表 + 复制
      const date = data.record.date
      const rec = await fetchJson<ReportRecord>(`/api/report/history/${date}`)
      setGeneratedDate(date)
      setDailyText(formatDaily(rec.items))
      setCopyMsg('')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copyDaily() {
    if (!dailyText.trim()) {
      setCopyMsg('暂无可复制内容')
      return
    }
    try {
      await navigator.clipboard.writeText(dailyText)
      setCopyMsg('已复制到剪贴板')
    } catch (e) {
      setCopyMsg(e instanceof Error ? e.message : '复制失败')
    }
  }

  return (
    <ReportLayout path="/report/generate">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>生成今日日报</CardTitle>
            <p className="mt-1 text-sm font-normal text-muted">
              只扫名单里已有仓库，或粘贴本地路径；不自动搜 cwd。
            </p>
          </div>
          <Button disabled={busy} onClick={() => void generate()}>
            {busy ? '生成中…' : '生成并归档'}
          </Button>
        </CardHeader>

        {repos.length ? (
          <div className="mb-4 grid max-h-56 grid-cols-1 gap-1.5 overflow-auto sm:grid-cols-2">
            {repos.map((r) => (
              <label
                key={r.path}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface/80"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!!selected[r.path]}
                  onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked
                    setSelected((s) => ({ ...s, [r.path]: on }))
                  }}
                />
                <span className="min-w-0">
                  <span className="font-medium">{r.display_name || r.alias}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">
                    {r.path}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted">名单为空时，请在下方输入仓库路径，或先去「名单」添加。</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>额外路径</Label>
            <Input
              value={extraPath}
              placeholder="/Users/me/proj"
              onInput={(e) => setExtraPath((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>附带杂事</Label>
            <Input
              value={append}
              placeholder="可选"
              onInput={(e) => setAppend((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>

        {msg ? (
          <p className={`mt-4 text-sm ${ok ? 'text-success' : busy ? 'text-muted' : 'text-destructive'}`}>
            {msg}
          </p>
        ) : null}
      </Card>

      {dailyText.trim() ? (
        <Card>
          <CardHeader>
            <CardTitle>生成结果 · {generatedDate}</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigate(`/report/history/${generatedDate}`)}
              >
                去编辑
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void copyDaily()}>
                复制
              </Button>
            </div>
          </CardHeader>
          {copyMsg ? <p className="mb-2 text-xs text-muted">{copyMsg}</p> : null}
          <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-surface/40 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-foreground">
            {dailyText}
          </pre>
        </Card>
      ) : null}
    </ReportLayout>
  )
}
