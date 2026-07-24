import { route } from 'preact-router'

const ROUTES = [
  {
    href: '/report',
    label: '日报',
    title: '日报台账',
    desc: '生成今日日报、查改归档、名单与偏好。',
    hint: 'Report',
  },
  {
    href: '/bench',
    label: '测速',
    title: '网关测速',
    desc: '对比模型首包与总耗时，定时探测看稳定性。',
    hint: 'Bench',
  },
  {
    href: '/setting',
    label: '设置',
    title: 'AI 配置',
    desc: '全局网关与模型，供 gc、report、agent 共用。',
    hint: 'Setting',
  },
] as const

export { ROUTES }

export function HomePage(_props: { path?: string }) {
  return (
    <div class="space-y-14">
      <section class="animate-rise max-w-2xl pt-2">
        <p class="font-display text-[clamp(3.2rem,10vw,5.2rem)] font-extrabold leading-[0.95] tracking-tight text-foreground">
          tkt
        </p>
        <h1 class="mt-5 text-[1.35rem] font-semibold tracking-tight text-foreground sm:text-[1.55rem]">
          本机工具，少打扰
        </h1>
        <p class="mt-3 max-w-md text-[0.95rem] leading-relaxed text-muted">
          日报台账、测网关、配模型，都在一个端口里。选一个能力开始。
        </p>
      </section>

      <section class="animate-rise-delay-1 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROUTES.map((item, i) => (
          <a
            key={item.href}
            href={item.href}
            onClick={(e) => {
              e.preventDefault()
              route(item.href)
            }}
            class={cnEntry(i)}
          >
            <div class="flex items-start justify-between gap-3">
              <h2 class="font-display text-xl font-bold tracking-tight">
                {item.title}
              </h2>
              <span
                class="mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-transform duration-300 group-hover:translate-x-0.5"
                aria-hidden
              >
                →
              </span>
            </div>
            <p class="mt-3 text-sm leading-relaxed text-muted">{item.desc}</p>
            <p class="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-primary/70">
              {item.hint}
            </p>
          </a>
        ))}
      </section>
    </div>
  )
}

function cnEntry(i: number) {
  return [
    'group relative block overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-6',
    'shadow-[0_1px_0_rgba(18,21,26,0.04)] backdrop-blur-sm',
    'transition-[transform,border-color,box-shadow] duration-300',
    'hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_12px_32px_-18px_rgba(26,95,122,0.45)]',
    i === 1 ? 'animate-rise-delay-1' : '',
    i === 2 ? 'animate-rise-delay-2' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
