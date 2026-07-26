import logoUrl from '@assets/logo.svg'
import { Plus, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import ProjectCard from '@/components/ProjectCard'
import TitleBar from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import { errorMessageOf } from '@/lib/format'
import type { ProjectSummary } from '../../../shared/ipc'

interface HomePageProps {
  onOpenProject(projectId: string): void
  onOpenSettings(): void
}

export default function HomePage({ onOpenProject, onOpenSettings }: HomePageProps): JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    try {
      setProjects(await window.logcut.listProjects())
    } catch (error: unknown) {
      setMessage(errorMessageOf(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = async (): Promise<void> => {
    try {
      const project = await window.logcut.createProject()
      onOpenProject(project.id)
    } catch (error: unknown) {
      setMessage(errorMessageOf(error))
    }
  }

  const remove = async (projectId: string): Promise<void> => {
    await window.logcut.deleteProject(projectId)
    await refresh()
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TitleBar>
        {/* The brand mark's only place in the UI since the sidebar went away. */}
        <img src={logoUrl} alt="" className="size-5 shrink-0" />
        <span className="flex-1 text-label font-medium text-foreground">LogCut</span>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Settings"
          className="[-webkit-app-region:no-drag]"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
        </Button>
      </TitleBar>

      <div className="min-h-0 flex-1 overflow-y-auto p-block">
        <div className="mb-block flex items-center justify-between gap-stack">
          <h1 className="text-h1 font-semibold text-foreground">Projects</h1>
          <Button onClick={() => void create()}>
            <Plus size={16} />
            New project
          </Button>
        </div>

        {message !== '' && (
          <p className="mb-stack text-caption font-normal text-destructive">{message}</p>
        )}

        {projects.length === 0 ? (
          <p className="text-body font-normal text-muted-foreground">
            No projects yet. Create one to import a video and generate subtitles.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-block">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={(id) => void remove(id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
