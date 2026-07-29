import { AlertTriangle, Film, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { DragEvent, JSX } from 'react'
import DropZone from '@/components/DropZone'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/format'
import { fileDropOf, MEDIA_ASSET_DRAG } from '@/lib/drag'
import type { MediaAssetSummary } from '../../../shared/ipc'

interface MediaTabProps {
  assets: MediaAssetSummary[]
  /** Highlighted here only; the timeline decides what is being edited. */
  selectedAssetId: string | null
  onImport(paths: string[]): void
  onSelect(assetId: string): void
  onRemove(assetId: string): void
}

/**
 * The library, not the edit. **Selecting an entry only highlights it** — an
 * asset reaches the timeline by being dragged, which is what
 * MEDIA_ASSET_DRAG carries. Layouts and drop behaviour: see MediaTab.md.
 */
export default function MediaTab({
  assets,
  selectedAssetId,
  onImport,
  onSelect,
  onRemove
}: MediaTabProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const { paths, error: reason } = fileDropOf(event.dataTransfer)
    setError(reason ?? '')
    if (paths.length > 0) onImport(paths)
  }

  const browse = async (): Promise<void> => {
    setError('')
    const paths = await window.logcut.pickMedia()
    if (paths.length > 0) onImport(paths)
  }

  // Empty: the import plate is the panel. DropZone carries its own drop
  // handling, so the wrapper below must not also claim the event.
  if (assets.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-inset">
        <DropZone onSelect={onImport} />
      </div>
    )
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-stack p-inset ${dragging ? 'bg-primary/5' : ''}`}
      onDragOver={(event) => {
        // Only for files from outside; an asset being dragged to the timeline
        // passes over this panel and must not be caught here.
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="flex shrink-0 items-center gap-component">
        <Button size="sm" onClick={() => void browse()}>
          <Plus size={14} />
          Import
        </Button>
        {error !== '' && <span className="text-caption font-normal text-destructive">{error}</span>}
      </div>

      {/* A fixed track, not `1fr`: the panel's width moves on its own — see
          MediaTab.md. */}
      <div className="grid min-h-0 grid-cols-[repeat(auto-fill,112px)] gap-component overflow-y-auto">
        {assets.map((asset) => {
          const selected = asset.id === selectedAssetId
          return (
            <div
              key={asset.id}
              role="button"
              tabIndex={0}
              draggable
              className="group flex cursor-grab flex-col gap-inline active:cursor-grabbing"
              onDragStart={(event) => {
                event.dataTransfer.setData(MEDIA_ASSET_DRAG, asset.id)
                event.dataTransfer.effectAllowed = 'copy'
                onSelect(asset.id)
              }}
              onClick={() => onSelect(asset.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(asset.id)
              }}
              title={asset.path}
            >
              {/* An inset outline, and it has to be all three parts:
                  - not `border`, which takes up space and shrinks the selected
                    card relative to its neighbours;
                  - not `ring`, which is a box-shadow and so is painted with the
                    element's own background, underneath every descendant — the
                    thumbnail's antialiased rounded clip eats the inner half of
                    the line, worst where the frame is bright;
                  - and offset inwards, because the grid scrolls: `overflow-y`
                    makes `overflow-x` compute to auto too, so the container
                    clips at its padding box and the top row's outward 1px falls
                    outside it. Drawn inside, it is still painted after every
                    descendant, so nothing covers it and nothing clips it. */}
              <div
                className={`relative aspect-video overflow-hidden rounded bg-muted outline-1 -outline-offset-1 transition-colors ${
                  selected ? 'outline-primary' : 'outline-transparent group-hover:outline-input'
                }`}
              >
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    <Film size={18} className="text-muted-foreground" />
                  </span>
                )}

                <span className="timecode absolute right-adjust bottom-adjust rounded-xs bg-black/70 px-inline text-caption text-white">
                  {formatDuration(asset.durationMs)}
                </span>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-adjust right-adjust bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 hover:text-white"
                  title="Remove from project"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(asset.id)
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>

              <span className="flex items-center gap-inline">
                {asset.missing && <AlertTriangle size={12} className="shrink-0 text-destructive" />}
                {!asset.missing && asset.stale && (
                  <AlertTriangle size={12} className="shrink-0 text-warning" />
                )}
                <span
                  className={`truncate text-caption font-normal ${
                    selected ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {asset.fileName}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
