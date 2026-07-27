import { Film, Trash2 } from 'lucide-react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { formatDuration, timeAgo } from '@/lib/format'
import type { ProjectSummary } from '../../../shared/ipc'

interface ProjectCardProps {
  project: ProjectSummary
  onOpen(id: string): void
  onDelete(id: string): void
}

export default function ProjectCard({ project, onOpen, onDelete }: ProjectCardProps): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative cursor-pointer overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
      onClick={() => onOpen(project.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen(project.id)
      }}
    >
      <div className="flex aspect-video items-center justify-center bg-muted">
        {project.thumbnailUrl ? (
          <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Film className="text-muted-foreground" size={28} />
        )}
      </div>
      <div className="flex flex-col gap-inline p-inset">
        <span className="truncate text-label font-medium text-foreground">{project.name}</span>
        <span className="text-caption font-normal text-muted-foreground">
          {project.assetCount === 0 ? 'Empty' : formatDuration(project.durationMs)} ·{' '}
          {timeAgo(project.updatedAt)}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-compact right-compact opacity-0 transition-opacity group-hover:opacity-100"
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
}
