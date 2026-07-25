import { useState } from 'react'
import type { DragEvent, JSX } from 'react'

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.webm', '.m4v', '.avi']

function isVideoFile(name: string): boolean {
  const lower = name.toLowerCase()
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

interface DropZoneProps {
  onSelect(videoPath: string): void
}

export default function DropZone({ onSelect }: DropZoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    setError('')
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (!isVideoFile(file.name)) {
      setError('Please drop a video file.')
      return
    }
    const videoPath = window.logcut.getPathForFile(file)
    if (!videoPath) {
      setError('Could not resolve the file path.')
      return
    }
    onSelect(videoPath)
  }

  const handleClick = async (): Promise<void> => {
    setError('')
    const videoPath = await window.logcut.pickVideo()
    if (videoPath) onSelect(videoPath)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed transition-colors ${
        dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-input hover:bg-muted/50'
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
      <p className="m-0 text-lg font-semibold">Drop a video here, or click to browse</p>
      <p className="m-0 text-muted-foreground">MP4, MOV, MKV, WebM…</p>
      {error !== '' && <p className="text-destructive">{error}</p>}
    </div>
  )
}
