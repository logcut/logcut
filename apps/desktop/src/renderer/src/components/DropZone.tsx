import { useState } from 'react'
import type { DragEvent, JSX } from 'react'
import { isSupportedMediaFile } from '../../../shared/media'

interface DropZoneProps {
  onSelect(paths: string[]): void
}

export default function DropZone({ onSelect }: DropZoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    setError('')
    const files = [...event.dataTransfer.files]
    if (files.length === 0) return
    const supported = files.filter((file) => isSupportedMediaFile(file.name))
    if (supported.length === 0) {
      setError('Please drop a video file.')
      return
    }
    const paths = supported.map((file) => window.logcut.getPathForFile(file)).filter(Boolean)
    if (paths.length === 0) {
      setError('Could not resolve the file path.')
      return
    }
    onSelect(paths)
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
      className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-inline rounded-lg border-2 border-dashed transition-colors ${
        dragging
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-input hover:bg-muted/50'
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
      <p className="m-0 text-body font-medium">Drop a video here, or click to browse</p>
      <p className="m-0 text-caption font-normal text-muted-foreground">MP4, MOV, MKV, WebM…</p>
      {error !== '' && <p className="m-0 text-caption font-normal text-destructive">{error}</p>}
    </div>
  )
}
