import type { LogcutApi } from '../../shared/ipc'

declare global {
  interface Window {
    logcut: LogcutApi
  }
}

export {}
