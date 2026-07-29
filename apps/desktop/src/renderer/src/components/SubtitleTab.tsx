import { defaultOption, languageOptionToConfig, orderedOptions } from '@logcut/core'
import type { LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'
import { ChevronRight, CircleHelp, Download, Loader2, PencilLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import LanguageSelect from '@/components/LanguageSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AsrState } from '@/hooks/useProject'
import {
  MAX_CHARS_MAX,
  MAX_CHARS_MIN,
  MAX_CHARS_SLIDER_MAX,
  type MediaAssetSummary,
  type TranscribePhase
} from '../../../shared/ipc'

const LINE_LENGTH_HINT =
  'The longest a subtitle line may get before it is split. Changing it re-splits the subtitles you already have — locally and for free — but rebuilds each line from its words, discarding manual text edits.'

function describePhase(phase: TranscribePhase): string {
  return phase === 'extracting' ? 'Extracting audio…' : 'Transcribing…'
}

/** A setting's name, with an optional hint. Shared by the rows in the list and
 *  the ones inside Advanced, which are laid out differently but named alike. */
function FieldName({ label, hint }: { label: string; hint?: string }): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-inline text-label text-foreground">
      {label}
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A button, not a bare icon: a hint has to be reachable without a
                pointer, and only a focusable element can be. */}
            <button
              type="button"
              aria-label={`About ${label.toLowerCase()}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <CircleHelp className="size-icon-sm" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{hint}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}

/** One setting per row: name above, control below at full width. **The row
 *  draws its own separator**, so a conditionally rendered row never leaves a
 *  stray line behind. */
function Field({
  label,
  hint,
  children
}: {
  label: string
  /** Shown on a help icon beside the name. For anything a name cannot carry. */
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-col gap-component border-b border-border py-stack">
      <FieldName label={label} hint={hint} />
      {children}
    </div>
  )
}

interface SubtitleTabProps {
  asset: MediaAssetSummary | null
  transcript: Transcript | null
  asr: AsrState
  /** Longest subtitle line, in characters; a project-wide setting. */
  maxChars: number
  onTranscribe(config: TranscribeConfig, force: boolean): void
  /** Switch the tab to its editing face. */
  onEdit(): void
  onExportSrt(): Promise<string | null>
  onOpenSettings(): void
  /** Resolves to the assets that could not be re-split, by id. */
  onMaxCharsChange(maxChars: number): Promise<string[]>
}

/**
 * Produces subtitles; it does not display them. The transcript lives on the
 * timeline, and editing happens in the subtitle column (see SubtitleTab.md).
 */
export default function SubtitleTab({
  asset,
  transcript,
  asr,
  maxChars,
  onTranscribe,
  onEdit,
  onExportSrt,
  onOpenSettings,
  onMaxCharsChange
}: SubtitleTabProps): JSX.Element {
  const [languageOrder, setLanguageOrder] = useState<LanguageOption[]>(orderedOptions('en-US'))
  const [language, setLanguage] = useState<LanguageOption>('auto')
  const [replace, setReplace] = useState(false)
  const [message, setMessage] = useState('')
  /** What the slider shows while it is being dragged; the project's value
   *  otherwise. Re-splitting on every frame of a drag would rewrite every
   *  transcript on disk dozens of times for one gesture. */
  const [lineLength, setLineLength] = useState(maxChars)
  /** The Advanced number box while it is being typed in. Kept as a string so a
   *  half-typed or momentarily empty value is not coerced into a number the
   *  slider would then jump to. */
  const [typedLength, setTypedLength] = useState(String(maxChars))
  const [advancedOpen, setAdvancedOpen] = useState(false)

  useEffect(() => {
    setLineLength(maxChars)
    setTypedLength(String(maxChars))
  }, [maxChars])

  useEffect(() => {
    void (async () => {
      const locale = await window.logcut.getSystemLocale()
      const saved = await window.logcut.getLanguagePreference()
      setLanguageOrder(orderedOptions(locale))
      setLanguage(saved ?? defaultOption(locale))
    })()
  }, [])

  const chooseLanguage = (option: LanguageOption): void => {
    setLanguage(option)
    void window.logcut.setLanguagePreference(option)
  }

  /** Fires when the drag ends, not while it moves. */
  const commitLineLength = async (next: number): Promise<void> => {
    if (next === maxChars) return
    setMessage('')
    try {
      const skipped = await onMaxCharsChange(next)
      if (skipped.length > 0) {
        setMessage(
          `${skipped.length} clip${skipped.length === 1 ? '' : 's'} kept the lines ${skipped.length === 1 ? 'it has' : 'they have'} — recognized before the original response was archived. Recognize again to re-split.`
        )
      }
    } catch {
      setMessage('Could not change the line length.')
      setLineLength(maxChars)
    }
  }

  /** Commit what was typed, or put the box back to the real value. Silence is
   *  the right answer to nonsense here — the field is not a form to be
   *  validated, it is a number that either parses or does not. */
  const commitTypedLength = (): void => {
    const parsed = Number.parseInt(typedLength, 10)
    if (Number.isNaN(parsed)) {
      setTypedLength(String(maxChars))
      return
    }
    const next = Math.min(MAX_CHARS_MAX, Math.max(MAX_CHARS_MIN, parsed))
    setTypedLength(String(next))
    setLineLength(next)
    void commitLineLength(next)
  }

  const exportSrt = async (): Promise<void> => {
    setMessage('')
    try {
      const savedPath = await onExportSrt()
      if (savedPath) setMessage(`Saved to ${savedPath}`)
    } catch {
      setMessage('Export failed.')
    }
  }

  // No asset is not an empty state: the panel keeps its shape and only the one
  // action goes dead. Replacing it with a sentence made the tab look like a
  // different, broken screen, and hid the language choice — which is worth
  // setting before importing anything.
  const running = asr.kind === 'running'
  const hasTranscript = transcript !== null && transcript.utterances.length > 0
  // Re-recognizing spends API credit and discards every manual edit, so with
  // subtitles already in hand it takes a deliberate opt-in. The checkbox sits
  // beside the button precisely so a disabled button is never a mystery.
  const blocked = hasTranscript && !replace

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-inset">
        <Field label="Source language">
          <LanguageSelect options={languageOrder} value={language} onChange={chooseLanguage} />
        </Field>

        {/* Collapsed by default: everything in here has a working value that
            most cuts never need to touch, and an open panel of them reads as
            work to be done. Line length lives in here rather than above it —
            the tuned default is right for nearly every cut, and a control that
            good is noise in the main list. */}
        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="border-b border-border py-stack"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-inline text-label text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight
              className={`size-icon-sm transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
            />
            Advanced
          </CollapsibleTrigger>

          {/* Applies to the next recognition and to the subtitles already in
              hand. **What it costs is manual text edits**, which is why the
              warning sits on the hint rather than waiting to be discovered.
              Ranges, and why the slider stops before the box does: see
              SubtitleTab.md. */}
          <CollapsibleContent className="flex items-center gap-component pt-stack">
            <FieldName label="Line length" hint={LINE_LENGTH_HINT} />
            <Slider
              value={[Math.min(lineLength, MAX_CHARS_SLIDER_MAX)]}
              min={MAX_CHARS_MIN}
              max={MAX_CHARS_SLIDER_MAX}
              step={1}
              onValueChange={([next]) => {
                setLineLength(next)
                setTypedLength(String(next))
              }}
              onValueCommit={([next]) => void commitLineLength(next)}
            />
            <Input
              type="number"
              min={MAX_CHARS_MIN}
              max={MAX_CHARS_MAX}
              value={typedLength}
              aria-label="Line length in characters"
              className="h-control-sm w-14 shrink-0 text-right"
              onChange={(event) => setTypedLength(event.target.value)}
              onBlur={commitTypedLength}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </CollapsibleContent>
        </Collapsible>

        <div className="flex flex-col gap-component py-stack">
          {/* The only other way in is a double-click on the timeline, which
              nothing on screen advertises. */}
          {hasTranscript && (
            <Button variant="outline" size="sm" className="self-start" onClick={onEdit}>
              <PencilLine size={14} />
              Edit subtitles
            </Button>
          )}
          {asr.kind === 'failed' && (
            <>
              <p className="m-0 text-caption font-normal text-destructive">{asr.message}</p>
              {asr.apiKeyProblem && (
                <Button variant="outline" size="sm" className="self-start" onClick={onOpenSettings}>
                  Open Settings
                </Button>
              )}
            </>
          )}
          {message !== '' && (
            <p className="m-0 text-caption font-normal break-all text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-component border-t border-border p-inset">
        {running ? (
          <span className="text-caption font-normal text-muted-foreground">
            {describePhase(asr.phase)} — this takes a few minutes.
          </span>
        ) : !asset ? (
          <span className="text-caption font-normal text-muted-foreground">
            Drag a video onto the timeline first.
          </span>
        ) : (
          hasTranscript && (
            <label className="flex cursor-pointer items-center gap-component text-caption font-normal text-muted-foreground">
              <Checkbox checked={replace} onCheckedChange={(state) => setReplace(state === true)} />
              Replace existing
            </label>
          )
        )}

        {/* Export lost its own row with the rest of the status readout, so it
            sits here as the secondary action rather than disappearing. */}
        <div className="ml-auto flex items-center gap-component">
          {hasTranscript && !running && (
            <Button variant="outline" size="sm" onClick={() => void exportSrt()}>
              <Download size={14} />
              Export SRT
            </Button>
          )}
          <Button
            disabled={!asset || running || blocked || asset.missing}
            onClick={() => onTranscribe(languageOptionToConfig(language), replace)}
          >
            {running && <Loader2 size={16} className="animate-spin" />}
            {hasTranscript ? 'Recognize again' : 'Start recognition'}
          </Button>
        </div>
      </div>
    </div>
  )
}
