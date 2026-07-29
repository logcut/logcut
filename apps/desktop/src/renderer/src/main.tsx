import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initOwnerStacks, setOwnerStacks } from './lib/dev-owner-stacks'
import './styles.css'

// Drives the title bar inset: only macOS hides the native title bar and needs
// room for the traffic lights (see .titlebar in styles.css).
if (navigator.userAgent.includes('Macintosh')) {
  document.documentElement.classList.add('is-mac')
}

// Before the first render: the switch works by making React skip work it would
// otherwise do while creating elements, so it has to be in place before any
// element is created.
initOwnerStacks()
window.logcut.onSetOwnerStacks(setOwnerStacks)

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
