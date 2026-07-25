import { Clock, Trash2, Video } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import type { ProjectSummary } from '../../../shared/ipc'

function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days <= 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(timestamp).toLocaleDateString()
}

interface MediaListProps {
  projects: ProjectSummary[]
  selectedId: string | null
  onOpen(id: string): void
  onDelete(id: string): void
}

export default function MediaList({
  projects,
  selectedId,
  onOpen,
  onDelete
}: MediaListProps): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
      {projects.length === 0 && (
        <p className="p-4 text-center text-xs text-muted-foreground">
          No media yet. Use Import to transcribe your first video.
        </p>
      )}
      {projects.map((project) => {
        const selected = project.id === selectedId
        return (
          <div
            key={project.id}
            className={`group relative mb-1 w-full rounded-lg border px-4 py-3 transition-all duration-200 ease-in-out ${
              project.fileExists
                ? `cursor-pointer bg-card/30 ${
                    selected
                      ? 'border-primary/50 bg-primary/[0.20]'
                      : 'border-border/80 hover:border-primary/40 hover:bg-primary/[0.20]'
                  }`
                : 'border-border/80 bg-card/30 opacity-50'
            }`}
            onClick={() => {
              if (project.fileExists) onOpen(project.id)
            }}
            title={project.fileExists ? project.videoPath : 'Video file missing'}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/30">
                <Video size={14} className="text-muted-foreground" />
              </div>
              <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-black/90 dark:text-white/90">
                {project.fileName}
              </h3>
            </div>
            <div className="mt-1.5 ml-7 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={12} className="shrink-0" />
              <span>
                {timeAgo(project.updatedAt)}
                {!project.fileExists && ' · Video missing'}
              </span>
            </div>
            {project.excerpt !== '' && (
              <p className="mt-1.5 mb-0 ml-7 line-clamp-1 text-xs text-muted-foreground/80">
                {project.excerpt}
              </p>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
              title="Delete project"
              onClick={(event) => {
                event.stopPropagation()
                onDelete(project.id)
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
