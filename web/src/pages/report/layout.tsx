import { route } from 'preact-router'
import { type ComponentChildren } from 'preact'
import { cn } from '@web/lib/utils'
import { REPORT_NAV } from '@web/pages/report/types'

export function ReportLayout({
  path,
  children,
}: {
  path: string
  children?: ComponentChildren
}) {
  return (
    <div class="space-y-6">
      <header class="space-y-3">
        <div>
          <h1 class="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            日报
          </h1>
          <p class="mt-1 max-w-xl text-sm text-muted">
            查改归档、管名单与偏好。生成在「生成」页。
          </p>
        </div>
        <nav class="flex flex-wrap gap-1 rounded-xl border border-border/80 bg-card/80 p-1">
          {REPORT_NAV.map((item) => {
            const active = item.exact
              ? path === item.href
              : path === item.href || path.startsWith(`${item.href}/`)
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  route(item.href)
                }}
                class={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted hover:bg-surface hover:text-foreground',
                )}
              >
                {item.label}
              </a>
            )
          })}
        </nav>
      </header>
      {children}
    </div>
  )
}
