import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import type { JSX } from 'react'
import SettingsPage from '@/components/SettingsPage'
import TitleBar from '@/components/TitleBar'
import { Button } from '@/components/ui/button'
import EditorPage from './pages/EditorPage'
import HomePage from './pages/HomePage'

type MainRoute = { name: 'home' } | { name: 'editor'; projectId: string }

/** Settings remembers where it was opened from, so Back returns there. */
type Route = MainRoute | { name: 'settings'; returnTo: MainRoute }

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'home' })

  if (route.name === 'settings') {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        <TitleBar>
          <Button
            variant="ghost"
            size="sm"
            className="[-webkit-app-region:no-drag]"
            onClick={() => setRoute(route.returnTo)}
          >
            <ArrowLeft size={16} />
            Back
          </Button>
          <span className="text-label font-medium text-foreground">Settings</span>
        </TitleBar>
        <div className="min-h-0 flex-1 overflow-y-auto p-block">
          <SettingsPage />
        </div>
      </div>
    )
  }

  if (route.name === 'editor') {
    return (
      <EditorPage
        projectId={route.projectId}
        onBack={() => setRoute({ name: 'home' })}
        onOpenSettings={() => setRoute({ name: 'settings', returnTo: route })}
      />
    )
  }

  return (
    <HomePage
      onOpenProject={(projectId) => setRoute({ name: 'editor', projectId })}
      onOpenSettings={() => setRoute({ name: 'settings', returnTo: route })}
    />
  )
}
