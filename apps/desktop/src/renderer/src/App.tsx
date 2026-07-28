import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import SettingsDialog from './components/SettingsDialog'
import { TooltipProvider } from './components/ui/tooltip'
import EditorPage from './pages/EditorPage'
import HomePage from './pages/HomePage'

/**
 * Routing, and the settings dialog. Settings is a dialog rather than a route,
 * so opening it never unmounts the editor.
 *
 * It is held here rather than by each page because its entry point is the
 * application menu (see main/menu.ts), which is not part of any page. The
 * editor still opens it directly — the subtitle tab sends the user here when
 * no API key is configured — so it takes the opener as a prop.
 */
type Route = { name: 'home' } | { name: 'editor'; projectId: string }

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => window.logcut.onOpenSettings(() => setSettingsOpen(true)), [])

  return (
    // One provider for the whole app: a tooltip needs an ancestor to share
    // timing with, so that moving between two hints does not re-wait the
    // opening delay each time.
    <TooltipProvider>
      {route.name === 'editor' ? (
        <EditorPage
          projectId={route.projectId}
          onBack={() => setRoute({ name: 'home' })}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : (
        <HomePage onOpenProject={(projectId) => setRoute({ name: 'editor', projectId })} />
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
  )
}
