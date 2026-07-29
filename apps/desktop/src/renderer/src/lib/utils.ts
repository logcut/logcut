import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * tailwind-merge ships Tailwind's *stock* scales and knows nothing about the
 * ones registered in styles.css, so every semantic utility has to be declared
 * here or merging silently gets it wrong — `text-label` reads as a colour and
 * loses to one, `h-*`/`p-*`/`gap-*` conflicts go unresolved (see utils.md).
 *
 * **Keep these lists in step with the `@theme inline` block in styles.css.**
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
