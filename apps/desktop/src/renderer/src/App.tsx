import { useState } from 'react'
import type { JSX } from 'react'
import EditorPage from './pages/EditorPage'
import HomePage from './pages/HomePage'

/**
 * Routing, and nothing else. Settings is a dialog rather than a route — each
 * page opens its own, so reaching it never unmounts the editor.
 */
type Route = { name: 'home' } | { name: 'editor'; projectId: string }

export default function App(): JSX.Element {
  const [route, setRoute] = useState<Route>({ name: 'home' })

  if (route.name === 'editor') {
    return <EditorPage projectId={route.projectId} />
  }

  return <HomePage onOpenProject={(projectId) => setRoute({ name: 'editor', projectId })} />
}
