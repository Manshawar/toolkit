import { useEffect, useState } from 'react'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'

type AiSetting = {
  backend?: 'claude' | 'openai'
  backendSource?: 'env' | 'config' | 'auto'
  backendPref?: 'claude' | 'openai' | 'auto'
  hasClaude?: boolean
  envPath: string
  packageEnv?: string
  baseUrl?: string
  apiKeyMasked?: string
  hasKey?: boolean
  model?: string
}

type BackendPref = 'claude' | 'openai' | 'auto'

const BACKEND_OPTIONS: Array<{ value: BackendPref; label: string; hint: string }> = [
  { value: 'auto', label: 'auto', hint: '有 claude CLI 用 Claude Code，否则自有配置' },
  { value: 'claude', label: 'Claude Code', hint: '本机 claude CLI，零配置' },
  { value: 'openai', label: 'OpenAI Compatible', hint: '下面的 Base URL / Key / Model' },
]

type UpdatePrefs = {
  checkIntervalHours: number
}

export function SettingPage() {
  const [info, setInfo] = useState<AiSetting | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  const [intervalHours, setIntervalHours] = useState('3')
  const [updateMsg, setUpdateMsg] = useState('')
  const [updateOk, setUpdateOk] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)

  const [backendPref, setBackendPref] = useState<BackendPref>('auto')
  const [backendMsg, setBackendMsg] = useState('')
  const [backendBusy, setBackendBusy] = useState(false)

  async function load() {
    try {
      const data = await fetchJson<AiSetting>('/api/setting/ai')
      setInfo(data)
      setBaseUrl(data.baseUrl || '')
      setModel(data.model || '')
      setApiKey('')
      setBackendPref(data.backendPref ?? 'auto')
      setBackendMsg('')
      setOk(Boolean(data.baseUrl && data.model && data.hasKey))
      setMsg(
        data.baseUrl && data.model && data.hasKey
          ? 'AI 配置已就绪'
          : '请填写 Base URL / API Key / Model',
      )
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function loadUpdate() {
    try {
      const data = await fetchJson<UpdatePrefs>('/api/setting/update')
      setIntervalHours(String(data.checkIntervalHours))
      setUpdateOk(true)
      setUpdateMsg(
        data.checkIntervalHours <= 0
          ? '已关闭自动检查'
          : `每 ${data.checkIntervalHours} 小时检查一次`,
      )
    } catch (e) {
      setUpdateOk(false)
      setUpdateMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function save() {
    setBusy(true)
    setMsg('保存中…')
    try {
      const data = await fetchJson<AiSetting & { saved?: string }>('/api/setting/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey,
          model: model.trim(),
        }),
      })
      setOk(true)
      setMsg(`已保存 → ${data.saved || data.envPath}`)
      await load()
    } catch (e) {
      setOk(false)
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveBackend(pref: BackendPref) {
    setBackendPref(pref)
    setBackendBusy(true)
    setBackendMsg('保存中…')
    try {
      await fetchJson<AiSetting>('/api/setting/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: pref }),
      })
      setBackendMsg('')
      await load()
    } catch (e) {
      setBackendMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBackendBusy(false)
    }
  }

  async function saveUpdate() {
    setUpdateBusy(true)
    setUpdateMsg('保存中…')
    try {
      const n = Number(intervalHours)
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('间隔须为 ≥0 的数字（0 = 关闭）')
      }
      const data = await fetchJson<UpdatePrefs>('/api/setting/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkIntervalHours: Math.floor(n) }),
      })
      setIntervalHours(String(data.checkIntervalHours))
      setUpdateOk(true)
      setUpdateMsg(
        data.checkIntervalHours <= 0
          ? '已关闭自动检查'
          : `已保存：每 ${data.checkIntervalHours} 小时检查一次`,
      )
    } catch (e) {
      setUpdateOk(false)
      setUpdateMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setUpdateBusy(false)
    }
  }

  useEffect(() => {
    void load()
    void loadUpdate()
  }, [])

  return (
    <div className="animate-rise mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          全局配置
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          AI 网关与 CLI 更新检查，写入本机配置，供 CLI 与 agent 共用。
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={`size-2 shrink-0 rounded-full ${ok ? 'bg-success' : 'bg-border'}`}
              aria-hidden
            />
            <CardTitle>AI 网关</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            刷新
          </Button>
        </CardHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>AI Backend</Label>
            <div className="flex flex-wrap gap-2">
              {BACKEND_OPTIONS.map((o) => (
                <Button
                  key={o.value}
                  variant={backendPref === o.value ? 'default' : 'secondary'}
                  size="sm"
                  disabled={backendBusy || info?.backendSource === 'env'}
                  title={o.hint}
                  onClick={() => void saveBackend(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted">
              {info?.backendSource === 'env'
                ? '已被 TKT_AI_BACKEND 环境变量强制，此处切换不生效'
                : `当前生效：${
                    info?.backend === 'claude' ? 'Claude Code' : 'OpenAI Compatible'
                  }${info?.hasClaude ? '' : ' · 未检测到 claude CLI'}`}
            </p>
            {backendMsg ? <p className="text-xs text-destructive">{backendMsg}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              placeholder="https://…/v1"
              onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              placeholder={
                info?.apiKeyMasked
                  ? `已保存 ${info.apiKeyMasked} · 留空不改`
                  : '粘贴密钥'
              }
              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={model}
              placeholder="模型 ID"
              onInput={(e) => setModel((e.target as HTMLInputElement).value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button disabled={busy} onClick={() => void save()}>
              保存配置
            </Button>
            <p
              className={`text-sm ${ok ? 'text-success' : msg.includes('请') ? 'text-muted' : 'text-destructive'}`}
            >
              {msg}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              className={`size-2 shrink-0 rounded-full ${updateOk ? 'bg-success' : 'bg-border'}`}
              aria-hidden
            />
            <CardTitle>更新检查</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadUpdate()}>
            刷新
          </Button>
        </CardHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>检查间隔（小时）</Label>
            <Input
              type="number"
              min={0}
              max={168}
              step={1}
              value={intervalHours}
              placeholder="3"
              onInput={(e) => setIntervalHours((e.target as HTMLInputElement).value)}
            />
            <p className="text-xs text-muted">默认 3；设为 0 关闭。CLI 启动时后台检查 npm 新版本。</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button disabled={updateBusy} onClick={() => void saveUpdate()}>
              保存
            </Button>
            <p
              className={`text-sm ${updateOk ? 'text-success' : updateMsg ? 'text-destructive' : 'text-muted'}`}
            >
              {updateMsg}
            </p>
          </div>
        </div>
      </Card>

      <div className="rounded-2xl border border-dashed border-border/90 bg-surface/40 px-5 py-4 text-sm leading-relaxed text-muted">
        <p>测速网关请在「测速」页单独配置；日报偏好在「日报」页。</p>
        <p className="mt-1.5">
          AI 配置供 <span className="text-foreground">tkt gc</span> /{' '}
          <span className="text-foreground">report</span> /{' '}
          <span className="text-foreground">agent</span> 使用；也可用{' '}
          <span className="text-foreground">tkt config</span>。
        </p>
      </div>
    </div>
  )
}
