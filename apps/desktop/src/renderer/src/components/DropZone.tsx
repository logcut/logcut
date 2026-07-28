import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { DragEvent, JSX } from 'react'
import { fileDropOf } from '@/lib/drag'

interface DropZoneProps {
  onSelect(paths: string[]): void
}

/** The import surface an empty media panel is made of — a filled plate, not a
 *  dashed outline (see DropZone.md). The whole plate is clickable, and
 *  dropping files on it works the same. */
export default function DropZone({ onSelect }: DropZoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const { paths, error: reason } = fileDropOf(event.dataTransfer)
    setError(reason ?? '')
    if (paths.length > 0) onSelect(paths)
  }

  const handleClick = async (): Promise<void> => {
    setError('')
    const paths = await window.logcut.pickMedia()
    if (paths.length > 0) onSelect(paths)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-component rounded-lg transition-colors ${
        dragging ? 'bg-primary/10 ring-1 ring-primary' : 'bg-muted/50 hover:bg-muted'
      }`}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => void handleClick()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') void handleClick()
      }}
    >
      <span className="flex items-center gap-component">
        <span className="flex size-control-lg items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Plus size={16} />
        </span>
        <span className="text-body font-medium text-foreground">Import</span>
      </span>
      <p className="m-0 text-caption font-normal text-muted-foreground">
        Drop a video here — MP4, MOV, MKV, WebM
      </p>
      {error !== '' && <p className="m-0 text-caption font-normal text-destructive">{error}</p>}
    </div>
  )
}
