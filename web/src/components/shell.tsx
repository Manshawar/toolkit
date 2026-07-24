import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@web/lib/utils'
import { CONFIG_ROUTES, FEATURE_ROUTES } from '@web/pages/home'

const FIRST_FEATURE = FEATURE_ROUTES[0]?.href ?? '/'

export function Shell({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname
  const isHome = path === '/'
  const inTools = FEATURE_ROUTES.some(
    (r) => path === r.href || path.startsWith(`${r.href}/`),
  )

  return (
    <div className="relative mx-auto min-h-screen max-w-[1040px] px-5 pb-20 pt-6 sm:px-8 sm:pt-8">
      <header
        className={cn(
          'mb-8 flex flex-wrap items-center justify-between gap-4',
          isHome && 'mb-10',
        )}
      >
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault()
            navigate('/')
          }}
          className="group flex items-baseline gap-2.5 text-inherit no-underline"
        >
          <span className="font-display text-[1.65rem] font-extrabold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-[1.85rem]">
            tkt
          </span>
          {!isHome ? (
            <span className="text-sm text-muted opacity-80">本地工具台</span>
          ) : null}
        </a>

        <nav className="flex items-center gap-0.5" aria-label="主导航">
          <NavLink href={FIRST_FEATURE} active={inTools} label="工具" />
          {CONFIG_ROUTES.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              active={path === item.href || path.startsWith(`${item.href}/`)}
              label={item.label}
            />
          ))}
        </nav>
      </header>

      {/* 脱离 topnav 文档流，宽度不挤占顶栏 */}
      {inTools ? <ToolsPin path={path} /> : null}

      <main className="animate-fade">{children}</main>
    </div>
  )
}

/** 页面右侧图钉：relative 于 Shell，不参与 header 宽度计算 */
function ToolsPin({ path }: { path: string }) {
  const navigate = useNavigate()
  return (
    <div
      className="pointer-events-none absolute right-5 top-8 z-20 w-11 sm:-right-8"
      aria-label="工具路由"
    >
      <div className="pointer-events-auto flex flex-col items-center gap-2 animate-fade">
        <button
          type="button"
          title="工具"
          onClick={() => navigate(FIRST_FEATURE)}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            'bg-primary text-[0.7rem] font-bold tracking-[0.12em] text-primary-foreground',
            'shadow-[0_8px_20px_-10px_rgba(26,95,122,0.65),0_1px_0_rgba(255,255,255,0.2)_inset]',
            'ring-2 ring-primary/20 ring-offset-2 ring-offset-background',
            'transition-transform hover:scale-105',
          )}
        >
          工具
        </button>
        <ul className="flex flex-col items-center gap-0.5">
          {FEATURE_ROUTES.map((item) => {
            const active =
              path === item.href || path.startsWith(`${item.href}/`)
            return (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(item.href)
                  }}
                  className={cn(
                    'block px-1 py-0.5 text-center text-sm transition-colors',
                    active
                      ? 'font-medium text-primary'
                      : 'text-muted hover:text-foreground',
                  )}
                >
                  {item.label}
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function NavLink({
  href,
  active,
  label,
}: {
  href: string
  active: boolean
  label: string
}) {
  const navigate = useNavigate()
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        navigate(href)
      }}
      className={cn(
        'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'text-primary'
          : 'text-muted hover:bg-surface/70 hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'absolute inset-x-3 -bottom-0.5 h-[2px] origin-left rounded-full bg-primary transition-transform duration-300',
          active ? 'scale-x-100' : 'scale-x-0',
        )}
      />
    </a>
  )
}
