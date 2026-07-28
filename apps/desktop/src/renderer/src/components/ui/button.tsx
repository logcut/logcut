import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Heights come from --size-control-* (see styles.css); nothing here hardcodes
  // one. The icon size belongs to each size step below and is never set here:
  // the two would compile to selectors of equal specificity, leaving the winner
  // to whichever utility Tailwind happens to emit last. A step that wants a
  // different glyph would silently lose. Callers pass lucide `size` as an
  // attribute, which any of these classes beats.
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-label font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
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
        // Feedback is the icon's colour, not a surface behind it, so the hit
        // area is free to be larger than anything the eye can see. For controls
        // sitting directly on the page background, where a hover block would be
        // the only filled shape in an otherwise empty strip.
        // `aria-pressed` is how a toggle in this variant shows it is on: the
        // icon takes the brand colour and stays there, the same feedback hover
        // gives, so nothing new has to be filled behind it.
        quiet: 'text-muted-foreground hover:text-primary aria-pressed:text-primary',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      // Every step states its own icon size. `:not([class*='size-'])` is what
      // lets a call site override it, so the escape hatch survives.
      size: {
        default: "h-control-md px-stack [&_svg:not([class*='size-'])]:size-icon-sm",
        xs: "h-control-sm gap-1 rounded-md px-compact text-caption [&_svg:not([class*='size-'])]:size-3",
        sm: "h-control-sm rounded-md px-component text-caption [&_svg:not([class*='size-'])]:size-icon-sm",
        lg: "h-control-lg rounded-md px-inset [&_svg:not([class*='size-'])]:size-icon-sm",
        icon: "size-control-md [&_svg:not([class*='size-'])]:size-icon-sm",
        'icon-xs': "size-control-sm rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': "size-control-sm [&_svg:not([class*='size-'])]:size-icon-sm",
        // The only step that departs from --icon-sm: at 28px a 14px glyph would
        // leave 7px a side, twice the breathing room every other step gives.
        'icon-lg': "size-control-lg [&_svg:not([class*='size-'])]:size-icon-md"
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
