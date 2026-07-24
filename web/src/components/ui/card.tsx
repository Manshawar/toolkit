import type { ReactNode } from 'react'
import { cn } from '@web/lib/utils'

export function Card({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <section
      className={cn(
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
  children?: ReactNode
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-3', className)}>
      {children}
    </div>
  )
}

export function CardTitle({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <h2 className={cn('font-display text-base font-bold tracking-tight', className)}>
      {children}
    </h2>
  )
}
