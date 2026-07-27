import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SettingsStatus, UpdateState } from '../../../shared/ipc'

/** What the update row says, and whether its button does anything. */
function updateLabel(state: UpdateState): string {
  switch (state.kind) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return `Downloading update… ${state.percent}%`
    case 'ready':
      return `Version ${state.version} is ready to install.`
    case 'current':
      return 'You are on the latest version.'
    case 'failed':
      return `Could not check for updates: ${state.message}`
    case 'unsupported':
      return 'Updates are only available in a packaged build.'
    case 'idle':
      return ''
  }
}

interface SettingsDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

/**
 * Settings as a modal rather than a page: it is a short form the user visits
 * to change one thing and leave, and routing away from a project to reach it
 * meant losing the editor's scroll and playback position.
 */
export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): JSX.Element {
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' })

  const refresh = useCallback(async () => {
    setStatus(await window.logcut.getSettingsStatus())
  }, [])

  // Re-read on every open: the key may have been set from another window.
  useEffect(() => {
    if (open) {
      setMessage('')
      void refresh()
      // The updater runs whether or not this dialog is mounted, so its state
      // has to be pulled on open rather than only followed from here.
      void window.logcut.getUpdateState().then(setUpdate)
      void window.logcut.getAppVersion().then(setVersion)
    }
  }, [open, refresh])

  useEffect(() => window.logcut.onUpdateState(setUpdate), [])

  const save = async (): Promise<void> => {
    setMessage('')
    try {
      await window.logcut.setApiKey(draft)
      setDraft('')
      setMessage('API key saved.')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save the API key.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Transcription runs on Volcano Engine and needs an API key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-component">
          <label className="text-label font-medium text-foreground" htmlFor="volc-api-key">
            Volcano Engine API key
          </label>
          <span className="text-caption font-normal text-muted-foreground">
            {status === null
              ? 'Checking…'
              : status.hasApiKey
                ? `Configured (…${status.apiKeyTail})`
                : 'Not configured'}
          </span>
          <div className="flex gap-component">
            <Input
              id="volc-api-key"
              type="password"
              placeholder="Paste your API key"
              className="flex-1"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draft.trim() !== '') void save()
              }}
            />
            <Button onClick={() => void save()} disabled={draft.trim() === ''}>
              Save
            </Button>
          </div>
          {message !== '' && (
            <p className="m-0 text-caption font-normal text-muted-foreground">{message}</p>
          )}
          <p className="m-0 text-caption font-normal text-muted-foreground">
            The key is encrypted with the operating system keychain and never leaves this device
            except to call the transcription API.
          </p>
        </div>

        <div className="flex flex-col gap-component border-t border-border pt-component">
          <span className="text-label font-medium text-foreground">
            {version === '' ? 'LogCut' : `LogCut ${version}`}
          </span>
          {updateLabel(update) !== '' && (
            <span className="text-caption font-normal text-muted-foreground">
              {updateLabel(update)}
            </span>
          )}
          {update.kind === 'ready' ? (
            <Button className="self-start" onClick={() => void window.logcut.installUpdate()}>
              Restart and install
            </Button>
          ) : (
            <Button
              variant="outline"
              className="self-start"
              disabled={
                update.kind === 'checking' ||
                update.kind === 'downloading' ||
                update.kind === 'unsupported'
              }
              onClick={() => void window.logcut.checkForUpdates()}
            >
              Check for updates
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
