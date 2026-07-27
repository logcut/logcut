import { AlertTriangle, Film, ListVideo, Trash2 } from 'lucide-react'
import type { JSX } from 'react'
import DropZone from '@/components/DropZone'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/format'
import { MEDIA_ASSET_DRAG } from '@/lib/drag'
import type { MediaAssetSummary } from '../../../shared/ipc'

interface MediaTabProps {
  assets: MediaAssetSummary[]
  /** Highlighted here only; the timeline decides what is being edited. */
  selectedAssetId: string | null
  /** Assets with at least one clip on the timeline, badged as such. */
  timelineAssetIds: string[]
  onImport(paths: string[]): void
  onSelect(assetId: string): void
  onRemove(assetId: string): void
}

/**
 * The library, not the edit. Selecting an entry only highlights it — an asset
 * reaches the timeline by being dragged there, which is what MEDIA_ASSET_DRAG
 * carries.
 */
export default function MediaTab({
  assets,
  selectedAssetId,
  timelineAssetIds,
  onImport,
  onSelect,
  onRemove
}: MediaTabProps): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-stack p-inset">
      {assets.length > 0 && (
        <div className="flex min-h-0 flex-col gap-component overflow-y-auto">
          {assets.map((asset) => {
            const selected = asset.id === selectedAssetId
            return (
              <div
                key={asset.id}
                role="button"
                tabIndex={0}
                draggable
                className={`group flex cursor-grab items-center gap-component rounded-lg border p-component transition-colors active:cursor-grabbing ${
                  selected ? 'border-primary bg-primary/10' : 'border-border hover:border-input'
                }`}
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
                <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {asset.thumbnailUrl ? (
                    <img src={asset.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Film size={16} className="text-muted-foreground" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-inline">
                    <span className="truncate text-label font-medium text-foreground">
                      {asset.fileName}
                    </span>
                    {/* Which entry is actually being edited is a property of
                        the timeline, not of the selection above. */}
                    {timelineAssetIds.includes(asset.id) && (
                      <ListVideo size={12} className="shrink-0 text-primary" />
                    )}
                  </span>
                  <span className="flex items-center gap-inline text-caption font-normal text-muted-foreground">
                    <span className="timecode">{formatDuration(asset.durationMs)}</span>
                    {asset.missing && (
                      <span className="flex items-center gap-inline text-destructive">
                        <AlertTriangle size={12} />
                        Missing
                      </span>
                    )}
                    {!asset.missing && asset.stale && (
                      <span className="flex items-center gap-inline text-warning">
                        <AlertTriangle size={12} />
                        Changed
                      </span>
                    )}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Remove from project"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(asset.id)
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      <div
        className={
          assets.length > 0 ? 'flex h-24 shrink-0 flex-col' : 'flex min-h-0 flex-1 flex-col'
        }
      >
        <DropZone onSelect={onImport} />
      </div>
    </div>
  )
}
