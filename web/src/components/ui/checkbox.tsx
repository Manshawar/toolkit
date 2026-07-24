import type { ComponentProps } from 'react'
import { cn } from '@web/lib/utils'

export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn(
        'size-4 shrink-0 rounded border-border text-primary accent-primary',
        className,
      )}
      {...props}
    />
  )
}
