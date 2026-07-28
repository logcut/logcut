import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

const toggleVariants = cva(
  // Heights come from --size-control-*, like every other control here; the
  // sizes shadcn ships (h-8/h-9/h-10) are touch targets and would make a
  // toggle the tallest thing in any row it sits in. Same reasoning as
  // button.tsx, and the two have to agree or a toggle beside a select is
  // visibly off.
  'inline-flex items-center justify-center gap-inline rounded-md text-label font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline:
          'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground'
      },
      // Each step states its own icon size, for the reason button.tsx spells
      // out: set in the base as well, the two rules tie on specificity and the
      // winner is whichever utility Tailwind happens to emit last.
      size: {
        default:
          "h-control-md min-w-control-md px-compact [&_svg:not([class*='size-'])]:size-icon-sm",
        sm: "h-control-sm min-w-control-sm px-inline [&_svg:not([class*='size-'])]:size-3",
        lg: "h-control-lg min-w-control-lg px-component [&_svg:not([class*='size-'])]:size-icon-md"
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
