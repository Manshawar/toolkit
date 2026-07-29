import { Fragment, useState } from 'react'
import { cn } from '@web/lib/utils'

/** collector get_snapshot 回传结构（全量） */
export type Snapshot = {
  env?: { url?: string; title?: string; ua?: string; lanxinVer?: string; net?: string }
  logs?: Array<{ level: string; text: string; ts: number }>
  requests?: Array<{
    method: string
    url: string
    status?: number
    errcode?: number
    ms?: number
    reqBody?: string
    respBody?: string
    ts: number
  }>
  errors?: Array<{ kind: string; message?: string; stack?: string; component?: string; ts: number }>
  clicks?: Array<{ selector: string; text?: string; ts: number }>
  mutations?: Array<{ type: string; payload?: string; ts: number }>
  routes?: Array<{ from: string; to: string; ts: number }>
}

const TABS = [
  ['requests', '请求'],
  ['logs', '日志'],
  ['errors', '异常'],
  ['mutations', 'Mutation'],
  ['trace', '轨迹'],
] as const

type TabKey = (typeof TABS)[number][0]

/** 数据核对面板：请求瀑布 / console 流 / 异常 / mutation / 点击+路由轨迹 */
export function DataPanels({ snapshot }: { snapshot: Snapshot }) {
  const [tab, setTab] = useState<TabKey>('requests')
  const [expanded, setExpanded] = useState<number | null>(null)

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setTab(key)
              setExpanded(null)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === key
                ? 'bg-primary/10 text-primary'
                : 'text-muted hover:bg-surface/70 hover:text-foreground',
            )}
          >
            {label}
            <span className="ml-1 text-muted/70">{countOf(snapshot, key)}</span>
          </button>
        ))}
      </div>

      <div className="max-h-[26rem] overflow-auto rounded-lg border border-border/60">
        {tab === 'requests' ? (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface/90 text-left text-muted backdrop-blur">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">#</th>
                <th className="px-2.5 py-1.5 font-medium">方法</th>
                <th className="px-2.5 py-1.5 font-medium">URL</th>
                <th className="px-2.5 py-1.5 font-medium">status</th>
                <th className="px-2.5 py-1.5 font-medium">errcode</th>
                <th className="px-2.5 py-1.5 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {(snapshot.requests ?? []).map((r, i) => {
                const bad = (r.status !== undefined && r.status >= 400) || (r.errcode !== undefined && r.errcode !== 200)
                return (
                  <Fragment key={i}>
                    <tr
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className={cn(
                        'cursor-pointer border-t border-border/40 hover:bg-surface/50',
                        bad && 'text-destructive',
                      )}
                    >
                      <td className="px-2.5 py-1.5 text-muted">{i}</td>
                      <td className="px-2.5 py-1.5 font-mono">{r.method}</td>
                      <td className="max-w-0 truncate px-2.5 py-1.5 font-mono" title={r.url}>
                        {r.url}
                      </td>
                      <td className="px-2.5 py-1.5">{r.status ?? '-'}</td>
                      <td className="px-2.5 py-1.5">{r.errcode ?? '-'}</td>
                      <td className="px-2.5 py-1.5 text-muted">{r.ms ?? '-'}ms</td>
                    </tr>
                    {expanded === i ? (
                      <tr className="border-t border-border/40 bg-surface/40">
                        <td colSpan={6} className="px-2.5 py-2">
                          <Kv label="reqBody" value={r.reqBody} />
                          <Kv label="respBody" value={r.respBody} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
              {!snapshot.requests?.length ? <Empty colSpan={6} text="暂无请求" /> : null}
            </tbody>
          </table>
        ) : null}

        {tab === 'logs' ? (
          <ul className="divide-y divide-border/40 text-xs">
            {(snapshot.logs ?? []).map((l, i) => (
              <li
                key={i}
                className={cn(
                  'px-2.5 py-1.5 font-mono',
                  l.level === 'error' && 'text-destructive',
                  l.level === 'warn' && 'text-[#b97a1f]',
                )}
              >
                <span className="mr-2 text-muted">[{l.level}]</span>
                {l.text}
              </li>
            ))}
            {!snapshot.logs?.length ? <EmptyLi text="暂无日志" /> : null}
          </ul>
        ) : null}

        {tab === 'errors' ? (
          <ul className="divide-y divide-border/40 text-xs">
            {(snapshot.errors ?? []).map((e, i) => (
              <li key={i} className="px-2.5 py-1.5">
                <span className="mr-2 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                  {e.kind}
                </span>
                {e.message}
                {e.component ? <span className="ml-1 text-muted">@{e.component}</span> : null}
                {e.stack ? (
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface/60 p-2 font-mono text-[0.7rem] text-muted">
                    {e.stack}
                  </pre>
                ) : null}
              </li>
            ))}
            {!snapshot.errors?.length ? <EmptyLi text="暂无异常" /> : null}
          </ul>
        ) : null}

        {tab === 'mutations' ? (
          <ul className="divide-y divide-border/40 text-xs">
            {(snapshot.mutations ?? []).map((m, i) => (
              <li key={i} className="px-2.5 py-1.5 font-mono">
                <span className="font-semibold">{m.type}</span>
                {m.payload ? <span className="ml-2 text-muted">{m.payload}</span> : null}
              </li>
            ))}
            {!snapshot.mutations?.length ? <EmptyLi text="暂无 mutation（页面无 Vuex 或未采集）" /> : null}
          </ul>
        ) : null}

        {tab === 'trace' ? (
          <ul className="divide-y divide-border/40 text-xs">
            {(snapshot.routes ?? []).map((r, i) => (
              <li key={`r${i}`} className="px-2.5 py-1.5 font-mono text-muted">
                路由 {r.from} → {r.to}
              </li>
            ))}
            {(snapshot.clicks ?? []).map((c, i) => (
              <li key={`c${i}`} className="px-2.5 py-1.5 font-mono">
                点击 {c.selector}
                {c.text ? <span className="ml-2 text-muted">{c.text}</span> : null}
              </li>
            ))}
            {!(snapshot.routes?.length || snapshot.clicks?.length) ? (
              <EmptyLi text="暂无轨迹" />
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function countOf(s: Snapshot, tab: TabKey): number {
  if (tab === 'requests') return s.requests?.length ?? 0
  if (tab === 'logs') return s.logs?.length ?? 0
  if (tab === 'errors') return s.errors?.length ?? 0
  if (tab === 'mutations') return s.mutations?.length ?? 0
  return (s.clicks?.length ?? 0) + (s.routes?.length ?? 0)
}

function Kv({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="mb-1">
      <span className="mr-2 text-muted">{label}:</span>
      <code className="whitespace-pre-wrap break-all">{value}</code>
    </div>
  )
}

function Empty({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-2.5 py-6 text-center text-muted">
        {text}
      </td>
    </tr>
  )
}

function EmptyLi({ text }: { text: string }) {
  return <li className="px-2.5 py-6 text-center text-muted">{text}</li>
}
