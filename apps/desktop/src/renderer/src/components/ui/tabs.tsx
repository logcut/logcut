import * as React from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

/**
 * A left-aligned rail of icon-over-label entries, not a segmented control.
 *
 * The segmented look shadcn ships divides the width evenly between however
 * many tabs exist, so it only reads well with two or three. This panel is
 * meant to grow to a dozen entries, so each one takes a fixed slot and the
 * row scrolls sideways once they no longer fit.
 */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'flex w-full shrink-0 items-stretch gap-inline overflow-x-auto border-b border-border text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className
      )}
      {...props}
    />
  )
}

/**
 * Children are read as icon first, label second — pass an icon element and a
 * string. Selection is carried by colour alone; a filled pill would fight the
 * panel it sits on now that the row has no track of its own.
 *
 * Every entry is readable at rest and the selected one is the brand colour —
 * so `primary`, never `accent`: shadcn's `accent` is the hover surface, and
 * using it here painted the selected tab a flat grey (DESIGN.md).
 */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'relative flex shrink-0 cursor-pointer flex-col items-center justify-center gap-adjust border-0 bg-transparent px-component py-component text-caption font-normal whitespace-nowrap transition-colors',
        'hover:text-primary focus-visible:ring-[2px] focus-visible:ring-ring/50 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        // The underline is a pseudo-element so it can sit flush on the list's
        // own border instead of adding height only the active tab has.
        "data-[state=active]:text-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-component data-[state=active]:after:-bottom-px data-[state=active]:after:h-px data-[state=active]:after:bg-primary data-[state=active]:after:content-['']",
        '[&_svg]:pointer-events-none [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
