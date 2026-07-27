import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge ships Tailwind's *stock* scales and knows nothing about the
 * ones registered in styles.css. Every semantic utility therefore has to be
 * declared here, or merging silently gets it wrong:
 *
 *  - `text-*` falls through to the text-colour group, so `text-label` and
 *    `text-primary-foreground` look like the same property and the colour,
 *    coming later, deletes the size. That is why every default button rendered
 *    at the inherited 16px however often the type scale was adjusted.
 *  - `h-*` / `p-*` / `gap-*` are simply unknown, so real conflicts are not
 *    resolved at all and both classes survive — which one applies is then down
 *    to the order Tailwind happened to emit them in.
 *
 * Keep these lists in step with the `@theme inline` block in styles.css.
 */
const TEXT_ROLES = ['caption', 'label', 'body', 'body-lg', 'h3', 'h2', 'h1', 'display', 'timecode']

/** One scale behind p-* / m-* / gap-* / w-* / h-* / size-* alike. */
const SPACING = [
  'adjust',
  'inline',
  'compact',
  'component',
  'stack',
  'inset',
  'block',
  'section-sm',
  'section',
  'page',
  'control-sm',
  'control-md',
  'control-lg',
  'icon-sm',
  'icon-md',
  'window-control'
]

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: TEXT_ROLES,
      spacing: SPACING,
      radius: ['panel', 'card']
    }
  }
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
