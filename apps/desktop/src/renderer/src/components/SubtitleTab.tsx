import { defaultOption, languageOptionToConfig, orderedOptions } from '@logcut/core'
import type { LanguageOption, TranscribeConfig, Transcript } from '@logcut/core'
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import LanguageSelect from '@/components/LanguageSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDuration } from '@/lib/format'
import type { AsrState } from '@/hooks/useProject'
import type { MediaAssetSummary, TranscribePhase } from '../../../shared/ipc'

function describePhase(phase: TranscribePhase): string {
  return phase === 'extracting' ? 'Extracting audio…' : 'Transcribing…'
}

/**
 * One setting per row, name on the left, control on the right, hairline
 * between. Rows carry their own separator rather than the list drawing them,
 * so a row can appear or disappear without leaving a stray line behind.
 */
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-component border-b border-border py-stack">
      <span className="text-label text-foreground">{label}</span>
      {children}
    </div>
  )
}

/** The same, for a control too wide to sit beside its name. */
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-component border-b border-border py-stack">
      <span className="text-label text-foreground">{label}</span>
      {children}
    </div>
  )
}

interface SubtitleTabProps {
  asset: MediaAssetSummary | null
  transcript: Transcript | null
  asr: AsrState
  onTranscribe(config: TranscribeConfig, force: boolean): void
  onExportSrt(): Promise<string | null>
  onOpenSettings(): void
}

/**
 * Produces subtitles; it does not display them. The transcript itself lives on
 * the timeline, and editing happens in the dialog a subtitle block opens.
 *
 * Laid out as a scrolling list of settings
 * rows, and the one action pinned to the bottom edge so it stays put however
 * many rows appear above it.
 */
export default function SubtitleTab({
  asset,
  transcript,
  asr,
  onTranscribe,
  onExportSrt,
  onOpenSettings
}: SubtitleTabProps): JSX.Element {
  const [languageOrder, setLanguageOrder] = useState<LanguageOption[]>(orderedOptions('en-US'))
  const [language, setLanguage] = useState<LanguageOption>('auto')
  const [replace, setReplace] = useState(false)
  const [message, setMessage] = useState('')

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

        {hasTranscript && (
          <>
            <Row label="Recognized">
              <span className="text-caption font-normal text-muted-foreground">
                {transcript.utterances.length} lines ·{' '}
                <span className="timecode">{formatDuration(transcript.audioDurationMs)}</span>
              </span>
            </Row>
            <Row label="Subtitle file">
              <Button variant="outline" size="sm" onClick={() => void exportSrt()}>
                <Download size={14} />
                Export SRT
              </Button>
            </Row>
          </>
        )}

        <div className="flex flex-col gap-component py-stack">
          {hasTranscript && (
            <p className="m-0 text-caption font-normal text-muted-foreground">
              Double-click a subtitle block on the timeline to edit the text.
            </p>
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

        <Button
          className="ml-auto"
          disabled={!asset || running || blocked || asset.missing}
          onClick={() => onTranscribe(languageOptionToConfig(language), replace)}
        >
          {running && <Loader2 size={16} className="animate-spin" />}
          {hasTranscript ? 'Recognize again' : 'Start recognition'}
        </Button>
      </div>
    </div>
  )
}
