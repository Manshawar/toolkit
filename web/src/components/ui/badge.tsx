import { type ComponentChildren } from 'preact'
import { cn } from '@web/lib/utils'

export function Badge({
  className,
  children,
}: {
  className?: string
  children?: ComponentChildren
}) {
  return (
    <span
      class={cn(
        'ml-2 inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-primary',
        className,
      )}
    >
      {children}
    </span>
  )
}
