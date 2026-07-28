import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@web/lib/utils'
import { CONFIG_ROUTES, FEATURE_ROUTES } from '@web/pages/home'

const FIRST_FEATURE = FEATURE_ROUTES[0]?.href ?? '/'
const COLLAPSE_KEY = 'tkt.sidebar.collapsed'

type NavItem = { href: string; label: string; desc?: string }

/** 顶栏分区：每个分区带一组侧栏路由 */
const SECTIONS: { id: string; label: string; href: string; items: readonly NavItem[] }[] = [
  { id: 'tools', label: '工具', href: FIRST_FEATURE, items: FEATURE_ROUTES },
  {
    id: 'config',
    label: '设置',
    href: CONFIG_ROUTES[0]?.href ?? '/setting',
    items: CONFIG_ROUTES,
  },
]

function matches(path: string, href: string): boolean {
  return path === href || path.startsWith(`${href}/`)
}

export function Shell({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname
  const isHome = path === '/'
  const section = SECTIONS.find((s) => s.items.some((i) => matches(path, i.href)))

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="shell-inner flex h-header items-center justify-between gap-4">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault()
              navigate('/')
            }}
            className="group flex items-baseline gap-2.5 text-inherit no-underline"
          >
            <span className="font-display text-[1.45rem] font-extrabold tracking-tight text-foreground transition-colors group-hover:text-primary">
              tkt
            </span>
            <span className="hidden text-sm text-muted opacity-80 sm:inline">
              本地工具台
            </span>
          </a>

          <nav className="flex items-center gap-1" aria-label="主导航">
            <TopLink href="/" active={isHome} label="首页" />
            {SECTIONS.map((s) => (
              <TopLink
                key={s.id}
                href={s.href}
                active={section?.id === s.id}
                label={s.label}
              />
            ))}
          </nav>
        </div>
      </header>

      <div className={cn('shell-inner', section && 'shell-body', section && collapsed && 'shell-body-collapsed')}>
        {section ? (
          <Sidebar
            title={section.label}
            items={section.items}
            path={path}
            collapsed={collapsed}
            onToggle={() => setCollapsed((v) => !v)}
          />
        ) : null}
        <main className="page-main animate-fade">{children}</main>
      </div>
    </div>
  )
}

/** 左侧路由栏：桌面竖列可收缩，移动端横向滚动 */
function Sidebar({
  title,
  items,
  path,
  collapsed,
  onToggle,
}: {
  title: string
  items: readonly NavItem[]
  path: string
  collapsed: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()
  return (
    <aside
      className="sticky top-header z-20 -mx-1 pt-6 md:pt-10"
      aria-label={`${title}导航`}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-3">
        {!collapsed ? (
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted/80">
            {title}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-expanded={!collapsed}
          className={cn(
            'hidden h-6 shrink-0 items-center justify-center rounded-md px-1',
            'font-mono text-[0.7rem] leading-none text-muted',
            'transition-colors hover:bg-surface hover:text-primary md:flex',
            collapsed && '-ml-1',
          )}
        >
          {collapsed ? '(＞_＞)' : '(＜_＜)'}
        </button>
      </div>

      <ul
        className={cn(
          'flex gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0',
          'md:rounded-2xl md:border md:border-border/60 md:bg-card/55 md:p-2',
          'md:shadow-[0_18px_40px_-28px_rgba(18,21,26,0.5)] md:backdrop-blur-xl',
        )}
      >
        {items.map((item) => {
          const active = matches(path, item.href)
          return (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  navigate(item.href)
                }}
                title={item.label}
                className={cn(
                  'relative block whitespace-nowrap rounded-lg text-[0.95rem] transition-colors duration-200',
                  collapsed
                    ? 'px-3 py-2 md:px-0 md:py-2 md:text-center md:text-xs md:font-semibold'
                    : 'px-3 py-2',
                  active
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-muted hover:bg-surface/80 hover:text-foreground',
                )}
              >
                {collapsed ? (
                  <>
                    <span className="md:hidden">{item.label}</span>
                    <span className="hidden md:inline">{item.label.slice(0, 2)}</span>
                  </>
                ) : (
                  item.label
                )}
              </a>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function TopLink({
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
        active ? 'text-primary' : 'text-muted hover:bg-surface/70 hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'absolute inset-x-3 bottom-1 h-[2px] origin-left rounded-full bg-primary transition-transform duration-300',
          active ? 'scale-x-100' : 'scale-x-0',
        )}
      />
    </a>
  )
}
