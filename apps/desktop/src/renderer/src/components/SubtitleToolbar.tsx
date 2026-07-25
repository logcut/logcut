import { Download, RefreshCw, Scissors, Search, Undo2 } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SubtitleToolbarProps {
  utteranceCount: number
  audioDurationMs: number
  canUndo: boolean
  findOpen: boolean
  findText: string
  replaceText: string
  message: string
  onUndo(): void
  onExportSrt(): void
  onRetranscribe(): void
  onResegment(): void
  onToggleFind(): void
  onFindTextChange(value: string): void
  onReplaceTextChange(value: string): void
  onReplaceAll(): void
}

export default function SubtitleToolbar({
  utteranceCount,
  audioDurationMs,
  canUndo,
  findOpen,
  findText,
  replaceText,
  message,
  onUndo,
  onExportSrt,
  onRetranscribe,
  onResegment,
  onToggleFind,
  onFindTextChange,
  onReplaceTextChange,
  onReplaceAll
}: SubtitleToolbarProps): JSX.Element {
  return (
    <div className="shrink-0">
      <div className="box-border flex h-[52px] items-center gap-1 p-2">
        <span className="px-1 text-xs whitespace-nowrap text-muted-foreground">
          {utteranceCount} utterances · {Math.round(audioDurationMs / 1000)}s
        </span>
        <div className="flex-1" />
        {canUndo && (
          <Button variant="ghost" size="icon" title="Undo" onClick={onUndo}>
            <Undo2 size={16} />
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onExportSrt}>
          <Download size={16} />
          Export SRT
        </Button>
        <Button variant="ghost" size="sm" onClick={onRetranscribe}>
          <RefreshCw size={16} />
          Re-transcribe
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Re-segment into subtitle-length lines"
          onClick={onResegment}
        >
          <Scissors size={16} />
        </Button>
        <Button
          variant={findOpen ? 'default' : 'ghost'}
          size="icon"
          title="Find and replace"
          onClick={onToggleFind}
        >
          <Search size={16} />
        </Button>
      </div>
      {findOpen && (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <Input
            autoFocus
            className="w-36"
            placeholder="Find"
            value={findText}
            onChange={(event) => onFindTextChange(event.target.value)}
          />
          <Input
            className="w-36"
            placeholder="Replace with"
            value={replaceText}
            onChange={(event) => onReplaceTextChange(event.target.value)}
          />
          <Button variant="ghost" size="sm" disabled={findText === ''} onClick={onReplaceAll}>
            Replace All
          </Button>
        </div>
      )}
      {message !== '' && <p className="m-0 px-3 pb-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  )
}
