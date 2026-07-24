import { type JSX } from 'preact'
import { cn } from '@web/lib/utils'

export function Label({
  class: className,
  className: classNameAlt,
  ...props
}: JSX.IntrinsicElements['label']) {
  return (
    <label
      class={cn(
        'text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
        className,
        classNameAlt,
      )}
      {...props}
    />
  )
}
