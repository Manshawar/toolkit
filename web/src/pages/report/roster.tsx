import { useEffect, useState } from 'react'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Checkbox } from '@web/components/ui/checkbox'
import { Input } from '@web/components/ui/input'
import { fetchJson } from '@web/lib/api'
import { ReportLayout } from '@web/pages/report/layout'
import type { ReportSettingView, RepoRow } from '@web/pages/report/types'

export function ReportRosterPage() {
  const [repos, setRepos] = useState<RepoRow[]>([])
  const [pathInput, setPathInput] = useState('')
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const s = await fetchJson<ReportSettingView>('/api/report/setting')
      setRepos(s.repositories || [])
      setOk(true)
      setMsg(`${s.repositories.filter((r) => r.enabled).length}/${s.repositories.length} 启用`)
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function save(next = repos) {
    setBusy(true)
    try {
      const data = await fetchJson<ReportSettingView>('/api/report/setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositories: next.map((r) => ({
            path: r.path,
            display_name: r.display_name,
            enabled: r.enabled,
            name_custom: r.name_custom || !!r.display_name.trim(),
          })),
        }),
      })
      setRepos(data.repositories || [])
      setOk(true)
      setMsg('名单已保存')
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addPath() {
    const p = pathInput.trim()
    if (!p) return
    setBusy(true)
    try {
      // 通过 generate 的 ensure 路径：只登记，用 dry 方式 — 直接 POST setting 不够
      // 用 generate with empty append + we need a register endpoint.
      // 临时：POST generate 太重。改用 setting + 让后端 ensure。
      // 这里调 generate 的 side-effect 太贵；加轻量 register：
      await fetchJson('/api/report/roster/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p }),
      })
      setPathInput('')
      await load()
      setOk(true)
      setMsg(`已加入：${p}`)
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
    <ReportLayout path="/report/roster">
      <Card>
        <CardHeader>
          <CardTitle>仓库名单</CardTitle>
          <Button disabled={busy} onClick={() => void save()}>
            保存
          </Button>
        </CardHeader>
        <p className="mb-4 text-sm text-muted">
          勾选后才会参与采集。书写名为日报【】内中文名。后续可再拆子页管理。
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <Input
            className="min-w-[220px] flex-1"
            value={pathInput}
            placeholder="添加本地仓库绝对路径…"
            onInput={(e) => setPathInput((e.target as HTMLInputElement).value)}
          />
          <Button variant="secondary" disabled={busy || !pathInput.trim()} onClick={() => void addPath()}>
            加入名单
          </Button>
        </div>

        <p className={`mb-3 text-sm ${ok ? 'text-success' : 'text-destructive'}`}>{msg}</p>

        {!repos.length ? (
          <p className="text-sm text-muted">名单为空。输入路径加入，或跑一次 CLI report。</p>
        ) : (
          <ul className="space-y-3">
            {repos.map((r, idx) => (
              <li
                key={r.path}
                className="rounded-xl border border-border/70 bg-background/40 px-3 py-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={r.enabled}
                      onChange={(e) => {
                        const on = (e.target as HTMLInputElement).checked
                        setRepos((list) =>
                          list.map((x, i) => (i === idx ? { ...x, enabled: on } : x)),
                        )
                      }}
                    />
                    启用
                  </label>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Input
                      value={r.display_name}
                      placeholder={r.alias || '中文书写名'}
                      onInput={(e) => {
                        const v = (e.target as HTMLInputElement).value
                        setRepos((list) =>
                          list.map((x, i) =>
                            i === idx ? { ...x, display_name: v, name_custom: true } : x,
                          ),
                        )
                      }}
                    />
                    <p className="truncate font-mono text-[11px] text-muted" title={r.path}>
                      {r.alias} · {r.path}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </ReportLayout>
  )
}
