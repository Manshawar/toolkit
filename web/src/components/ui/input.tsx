import { type JSX } from 'preact'
import { cn } from '@web/lib/utils'

export function Input({ className, ...props }: JSX.IntrinsicElements['input']) {
  return (
    <input
      class={cn(
        'flex h-10 w-full rounded-md border border-border bg-white/90 px-3 py-2 text-sm text-foreground shadow-none transition-colors placeholder:text-muted/70 focus-visible:border-primary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
