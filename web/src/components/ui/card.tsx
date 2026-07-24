import { type ComponentChildren } from 'preact'
import { cn } from '@web/lib/utils'

export function Card({
  className,
  children,
}: {
  className?: string
  children?: ComponentChildren
}) {
  return (
    <section
      class={cn(
        'rounded-2xl border border-border/80 bg-card/90 p-5 shadow-[0_1px_0_rgba(18,21,26,0.04)] backdrop-blur-sm sm:p-6',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardHeader({
  className,
  children,
}: {
  className?: string
  children?: ComponentChildren
}) {
  return (
    <div class={cn('mb-4 flex flex-wrap items-center gap-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({
  class: className,
  children,
}: {
  class?: string
  children?: ComponentChildren
}) {
  return (
    <h2 class={cn('font-display text-base font-bold tracking-tight', className)}>
      {children}
    </h2>
  )
}
