import { type ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { cn } from '@web/lib/utils'
import { CONFIG_ROUTES, FEATURE_ROUTES } from '@web/pages/home'

export function Shell({
  path,
  children,
}: {
  path: string
  children?: ComponentChildren
}) {
  const isHome = path === '/'
  const featureActive = FEATURE_ROUTES.some(
    (r) => path === r.href || path.startsWith(`${r.href}/`),
  )

  return (
    <div class="relative mx-auto min-h-screen max-w-[1040px] px-5 pb-20 pt-6 sm:px-8 sm:pt-8">
      <header
        class={cn(
          'mb-8 flex flex-wrap items-center justify-between gap-4',
          isHome && 'mb-10',
        )}
      >
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault()
            route('/')
          }}
          class="group flex items-baseline gap-2.5 text-inherit no-underline"
        >
          <span class="font-display text-[1.65rem] font-extrabold tracking-tight text-foreground transition-colors group-hover:text-primary sm:text-[1.85rem]">
            tkt
          </span>
          {!isHome ? (
            <span class="text-sm text-muted opacity-80">本地工具台</span>
          ) : null}
        </a>

        <nav class="flex items-center gap-0.5">
          <ToolsMenu path={path} active={featureActive} />
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

      <main class="animate-fade">{children}</main>
    </div>
  )
}

function ToolsMenu({ path, active }: { path: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [path])

  return (
    <div class="relative" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        class={cn(
          'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
          active || open
            ? 'text-primary'
            : 'text-muted hover:bg-surface/70 hover:text-foreground',
        )}
      >
        工具
        <span
          class={cn(
            'ml-1 inline-block text-[10px] opacity-70 transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        >
          ▾
        </span>
        <span
          class={cn(
            'absolute inset-x-3 -bottom-0.5 h-[2px] origin-left rounded-full bg-primary transition-transform duration-300',
            active ? 'scale-x-100' : 'scale-x-0',
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          class="absolute right-0 z-40 mt-1.5 min-w-[10.5rem] overflow-hidden rounded-xl border border-border/80 bg-card py-1 shadow-[0_12px_32px_-16px_rgba(18,21,26,0.35)]"
        >
          {FEATURE_ROUTES.map((item) => {
            const itemActive =
              path === item.href || path.startsWith(`${item.href}/`)
            return (
              <a
                key={item.href}
                role="menuitem"
                href={item.href}
                onClick={(e) => {
                  e.preventDefault()
                  setOpen(false)
                  route(item.href)
                }}
                class={cn(
                  'block px-3.5 py-2 text-sm transition-colors',
                  itemActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground hover:bg-surface/80',
                )}
              >
                {item.label}
              </a>
            )
          })}
        </div>
      ) : null}
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
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        route(href)
      }}
      class={cn(
        'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'text-primary'
          : 'text-muted hover:bg-surface/70 hover:text-foreground',
      )}
    >
      {label}
      <span
        class={cn(
          'absolute inset-x-3 -bottom-0.5 h-[2px] origin-left rounded-full bg-primary transition-transform duration-300',
          active ? 'scale-x-100' : 'scale-x-0',
        )}
      />
    </a>
  )
}
