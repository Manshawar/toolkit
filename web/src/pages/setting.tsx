import { useEffect, useState } from 'preact/hooks'
import { Button } from '@web/components/ui/button'
import { Card, CardHeader, CardTitle } from '@web/components/ui/card'
import { Input } from '@web/components/ui/input'
import { Label } from '@web/components/ui/label'
import { fetchJson } from '@web/lib/api'

type AiSetting = {
  envPath: string
  packageEnv?: string
  baseUrl?: string
  apiKeyMasked?: string
  hasKey?: boolean
  model?: string
}

export function SettingPage(_props: { path?: string }) {
  const [info, setInfo] = useState<AiSetting | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await fetchJson<AiSetting>('/api/setting/ai')
      setInfo(data)
      setBaseUrl(data.baseUrl || '')
      setModel(data.model || '')
      setApiKey('')
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

  useEffect(() => {
    void load()
  }, [])

  return (
    <div class="animate-rise mx-auto max-w-xl space-y-6">
      <header class="space-y-2">
        <h1 class="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          AI 配置
        </h1>
        <p class="text-sm leading-relaxed text-muted">
          全局 OpenAI Compatible 网关，写入本机配置，供 CLI 与 agent 共用。
        </p>
      </header>

      <Card>
        <CardHeader>
          <div class="flex min-w-0 flex-1 items-center gap-2.5">
            <span
              class={`size-2 shrink-0 rounded-full ${ok ? 'bg-success' : 'bg-border'}`}
              aria-hidden
            />
            <CardTitle>网关</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            刷新
          </Button>
        </CardHeader>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={baseUrl}
              placeholder="https://…/v1"
              onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="space-y-1.5">
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
          <div class="space-y-1.5">
            <Label>Model</Label>
            <Input
              value={model}
              placeholder="模型 ID"
              onInput={(e) => setModel((e.target as HTMLInputElement).value)}
            />
          </div>

          <div class="flex flex-wrap items-center gap-3 pt-1">
            <Button disabled={busy} onClick={() => void save()}>
              保存配置
            </Button>
            <p
              class={`text-sm ${ok ? 'text-success' : msg.includes('请') ? 'text-muted' : 'text-destructive'}`}
            >
              {msg}
            </p>
          </div>
        </div>
      </Card>

      <div class="rounded-2xl border border-dashed border-border/90 bg-surface/40 px-5 py-4 text-sm leading-relaxed text-muted">
        <p>测速网关请在「测速」页单独配置；日报偏好在「日报」页。</p>
        <p class="mt-1.5">
          此处供 <span class="text-foreground">tkt gc</span> /{' '}
          <span class="text-foreground">report</span> /{' '}
          <span class="text-foreground">agent</span> 使用；也可用{' '}
          <span class="text-foreground">tkt config</span>。
        </p>
      </div>
    </div>
  )
}
