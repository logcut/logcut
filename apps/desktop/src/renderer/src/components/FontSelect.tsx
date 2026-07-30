import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCaptionFonts } from '@/hooks/useCaptionFonts'
import { useRecentFonts } from '@/hooks/useRecentFonts'
import { captionFontStack, type CaptionFont } from '@/lib/caption-fonts'

interface FontSelectProps {
  /** The stored `CaptionStyle.fontFamily`. */
  value: string
  onChange(value: string): void
}

export default function FontSelect({ value, onChange }: FontSelectProps): JSX.Element {
  const fonts = useCaptionFonts()
  const { recent, remember } = useRecentFonts()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  /** A font this machine no longer has is still a value worth naming, so the
   *  list is built by lookup with a fallback rather than by filtering. */
  const recentFonts = useMemo(
    (): CaptionFont[] =>
      recent.map(
        (stored) =>
          fonts.find((font) => font.value === stored) ?? {
            value: stored,
            label: stored,
            stack: captionFontStack(stored, fonts)
          }
      ),
    [recent, fonts]
  )

  const needle = query.trim().toLowerCase()
  const matching = (font: CaptionFont): boolean => font.label.toLowerCase().includes(needle)
  const shownRecent = recentFonts.filter(matching)
  const shownAll = fonts.filter(matching)

  /** **Every close goes through here**, and picking a font is one of them.
   *  Dropping the search term on the way out is the whole reason: a list that
   *  reopens still filtered looks like most of the machine's fonts have gone
   *  missing, and a pick closes the popover without `onOpenChange` firing. */
  const close = (): void => {
    setOpen(false)
    setQuery('')
  }

  const choose = (next: string): void => {
    close()
    remember(next)
    // Picking what is already set is not an edit — it would still cost an undo
    // step on the two project-wide scopes (see pages/EditorPage.md).
    if (next !== value) onChange(next)
  }

  const row = (font: CaptionFont, group: string): JSX.Element => (
    // **The value only has to be unique**, which the group prefix makes it —
    // the same font appears under Recent and under All fonts, and cmdk uses
    // this to track which row the keyboard is on. What gets picked comes from
    // the closure, so the prefix never has to be parsed back off.
    <CommandItem
      key={`${group}:${font.value}`}
      value={`${group}:${font.value}`}
      onSelect={() => choose(font.value)}
    >
      {/* Each row set in the font it offers: the names alone say nothing about
          what the caption will look like. */}
      <span className="flex-1 truncate" style={{ fontFamily: font.stack }}>
        {font.label}
      </span>
      {font.value === value && <CheckIcon />}
    </CommandItem>
  )

  const selected = fonts.find((font) => font.value === value)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else close()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="field" role="combobox" aria-expanded={open} className="w-full">
          <span className="truncate" style={{ fontFamily: captionFontStack(value, fonts) }}>
            {selected?.label ?? value}
          </span>
          <ChevronDownIcon />
        </Button>
      </PopoverTrigger>
      {/* `p-0` because Command brings its own padding — the shadcn combobox
          recipe (see FontSelect.md). */}
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search fonts…" />
          <CommandList>
            {/* Renders itself when nothing is left, and nothing is left exactly
                when the filter above kept no rows — the unmatched fonts are not
                in the DOM at all, so cmdk's own count is already the answer. */}
            <CommandEmpty>No font found.</CommandEmpty>
            {shownRecent.length > 0 && (
              <>
                <CommandGroup heading="Recent">
                  {shownRecent.map((font) => row(font, 'recent'))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            {shownAll.length > 0 && (
              <CommandGroup heading="All fonts">
                {shownAll.map((font) => row(font, 'all'))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
