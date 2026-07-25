import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SettingsStatus } from '../../../shared/ipc'

export default function SettingsPage(): JSX.Element {
  const [status, setStatus] = useState<SettingsStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    setStatus(await window.logcut.getSettingsStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
    <section className="max-w-[560px]">
      <h2 className="text-xl font-semibold">Settings</h2>
      <div className="mt-3">
        <label className="font-semibold" htmlFor="volc-api-key">
          Volcano Engine API key
        </label>
        <p className="my-1.5 opacity-75">
          {status === null
            ? 'Checking…'
            : status.hasApiKey
              ? `Configured (…${status.apiKeyTail})`
              : 'Not configured'}
        </p>
        <div className="flex gap-2">
          <Input
            id="volc-api-key"
            type="password"
            placeholder="Paste your API key"
            className="flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button onClick={() => void save()} disabled={draft.trim() === ''}>
            Save
          </Button>
        </div>
        {message !== '' && <p className="mt-2 mb-0">{message}</p>}
        <p className="mt-3 text-xs opacity-60">
          The key is encrypted with the operating system keychain and never leaves this device
          except to call the transcription API.
        </p>
      </div>
    </section>
  )
}
