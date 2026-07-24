import { type ComponentChildren } from 'preact'
import { route } from 'preact-router'
import { cn } from '@web/lib/utils'
import { ROUTES } from '@web/pages/home'

export function Shell({
  path,
  children,
}: {
  path: string
  children?: ComponentChildren
}) {
  const isHome = path === '/'

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
          <NavLink href="/" active={isHome} label="首页" />
          {ROUTES.map((item) => (
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
