import fs from 'node:fs'
import { parseVolcanoResponse } from '@logcut/core'
import type { TranscribeConfig, Transcript } from '@logcut/core'

const FLASH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash'
const RESOURCE_ID = 'volc.bigasr.auc_turbo'
const SUCCESS_STATUS = '20000000'

/** The mapped transcript plus the untouched provider response, for archival. */
export interface TranscribeResult {
  transcript: Transcript
  /** Raw provider response body, saved verbatim as an immutable rollback source. */
  raw: unknown
}

/**
 * Transcribe an audio file with the Volcano Engine flash (synchronous) ASR.
 * Error messages are prefixed with a stable code so the renderer can react:
 * API_KEY_INVALID, NETWORK, ASR_FAILED.
 */
export async function transcribeAudio(
  audioPath: string,
  apiKey: string,
  config: TranscribeConfig = {}
): Promise<TranscribeResult> {
  const audioBase64 = fs.readFileSync(audioPath).toString('base64')

  const audio: Record<string, string> = { format: 'mp3', data: audioBase64 }
  if (config.language) audio.language = config.language
  const request: Record<string, unknown> = {
    model_name: 'bigmodel',
    enable_itn: true,
    enable_punc: true,
    enable_speaker_info: true,
    show_utterances: true
  }
  if (config.zhVariant) request.output_zh_variant = config.zhVariant

  let response: Response
  try {
    response = await fetch(FLASH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': crypto.randomUUID(),
        'X-Api-Sequence': '-1'
      },
      body: JSON.stringify({ user: { uid: 'logcut' }, audio, request })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`NETWORK: Could not reach the transcription service (${message})`)
  }

  const statusCode = response.headers.get('X-Api-Status-Code')
  const statusMessage = response.headers.get('X-Api-Message') ?? response.statusText

  if (response.status === 401 || response.status === 403) {
    throw new Error('API_KEY_INVALID: The transcription service rejected the API key')
  }
  if (!response.ok || statusCode !== SUCCESS_STATUS) {
    if (/auth|key|permission|forbidden/i.test(statusMessage)) {
      throw new Error(`API_KEY_INVALID: ${statusMessage}`)
    }
    throw new Error(`ASR_FAILED: ${statusCode ?? response.status} ${statusMessage}`)
  }

  // Parsed by the core, which also parses this same body months later when the
  // archived copy is re-split at a new line length (see core/volcano.ts).
  const data: unknown = await response.json()
  const transcript = parseVolcanoResponse(data)
  if (transcript.utterances.length === 0) {
    throw new Error('ASR_FAILED: The service returned no utterances for this audio')
  }

  return { transcript, raw: data }
}
