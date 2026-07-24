import type { ComponentProps } from 'react'
import { cn } from '@web/lib/utils'

export function Label({
  className,
  ...props
}: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
        className,
      )}
      {...props}
    />
  )
}
