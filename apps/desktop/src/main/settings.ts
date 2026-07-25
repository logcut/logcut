import type { LanguageOption } from '@logcut/core'
import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { SettingsStatus } from '../shared/ipc'

interface SettingsFile {
  /** Base64 of the safeStorage-encrypted Volcano Engine API key. */
  volcApiKey?: string
  /** Last chosen transcription language (non-sensitive, stored in plaintext). */
  languageOption?: LanguageOption
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettingsFile(): SettingsFile {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as SettingsFile
  } catch {
    return {}
  }
}

function writeSettingsFile(settings: SettingsFile): void {
  const file = settingsPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2))
}

export function setApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key must not be empty')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encrypted storage is not available on this system')
  }
  const encrypted = safeStorage.encryptString(trimmed).toString('base64')
  writeSettingsFile({ ...readSettingsFile(), volcApiKey: encrypted })
}

/** Returns the plaintext key for main-process use only. Never send it to the renderer. */
export function getApiKey(): string | null {
  const { volcApiKey } = readSettingsFile()
  if (!volcApiKey) return null
  try {
    return safeStorage.decryptString(Buffer.from(volcApiKey, 'base64'))
  } catch {
    return null
  }
}

export function getStatus(): SettingsStatus {
  const key = getApiKey()
  return { hasApiKey: key !== null, apiKeyTail: key ? key.slice(-4) : '' }
}

export function getLanguageOption(): LanguageOption | null {
  return readSettingsFile().languageOption ?? null
}

export function setLanguageOption(option: LanguageOption): void {
  writeSettingsFile({ ...readSettingsFile(), languageOption: option })
}
