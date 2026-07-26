import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Drives the title bar inset: only macOS hides the native title bar and needs
// room for the traffic lights (see .titlebar in styles.css).
if (navigator.userAgent.includes('Macintosh')) {
  document.documentElement.classList.add('is-mac')
}

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
