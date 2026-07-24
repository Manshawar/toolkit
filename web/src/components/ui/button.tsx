import { cva, type VariantProps } from 'class-variance-authority'
import { type JSX } from 'preact'
import { cn } from '@web/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[transform,background-color,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_1px_0_rgba(18,21,26,0.08)] hover:bg-[#174f66]',
        secondary:
          'border border-border bg-card/80 text-foreground hover:border-primary/30 hover:bg-accent/60',
        ghost: 'text-foreground hover:bg-surface/80',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends Omit<JSX.IntrinsicElements['button'], 'size'>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button class={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
