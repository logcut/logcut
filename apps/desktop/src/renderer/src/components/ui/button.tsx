import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-label font-medium whitespace-nowrap [transition:var(--transition-control)] outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        quiet: 'text-foreground hover:text-primary aria-pressed:text-primary',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      // Icon size and press scale are stated per step and never in the base
      // class: written in both they compile to selectors of equal specificity,
      // and the winner is whichever utility Tailwind emits last, so a step
      // wanting a different value loses silently. `:not([class*='size-'])`
      // keeps the call site's escape hatch. Both scales: see DESIGN.md.
      size: {
        default:
          "h-control-md px-stack active:scale-[var(--press-scale)] [&_svg:not([class*='size-'])]:size-icon-sm",
        xs: "h-control-sm gap-1 rounded-md px-compact text-caption active:scale-[var(--press-scale)] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm rounded-md px-component text-caption active:scale-[var(--press-scale)] [&_svg:not([class*='size-'])]:size-icon-sm",
        lg: "h-control-lg rounded-md px-inset active:scale-[var(--press-scale)] [&_svg:not([class*='size-'])]:size-icon-sm",
        icon: "size-control-md active:scale-[var(--press-scale-icon)] [&_svg:not([class*='size-'])]:size-icon-sm",
        'icon-xs':
          "size-control-sm rounded-md active:scale-[var(--press-scale-icon)] [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          "size-control-sm active:scale-[var(--press-scale-icon)] [&_svg:not([class*='size-'])]:size-icon-sm",
        // The one step that departs from --icon-sm: at 28px a 14px glyph leaves
        // 7px a side, twice what every other step gives.
        'icon-lg':
          "size-control-lg active:scale-[var(--press-scale-icon)] [&_svg:not([class*='size-'])]:size-icon-md"
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
