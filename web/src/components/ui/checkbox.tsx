import { type JSX } from 'preact'
import { cn } from '@web/lib/utils'

export function Checkbox({
  className,
  ...props
}: Omit<JSX.IntrinsicElements['input'], 'type'>) {
  return (
    <input
      type="checkbox"
      class={cn(
        'size-4 shrink-0 rounded border-border text-primary accent-primary',
        className,
      )}
      {...props}
    />
  )
}
