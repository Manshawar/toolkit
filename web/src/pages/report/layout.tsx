import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@web/lib/utils'
import { REPORT_NAV } from '@web/pages/report/types'

export function ReportLayout({
  path: pathProp,
  children,
}: {
  path?: string
  children?: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const path = pathProp ?? location.pathname
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            日报
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            查改归档、管名单与偏好。生成在「生成」页。
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-xl border border-border/80 bg-card/80 p-1">
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
                  navigate(item.href)
                }}
                className={cn(
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
