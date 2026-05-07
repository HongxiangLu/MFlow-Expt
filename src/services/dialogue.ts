import { apiPaths, getApiUrl, type RequestOptions } from './api'
import type { ChatRequest, ChatSseErrorEvent, ChatSseFrame } from '../types'

export type ChatStreamOptions = RequestOptions & {
  onFrame?: (frame: ChatSseFrame) => void
  onError?: (event: ChatSseErrorEvent) => void
}

type SseEventBlock = {
  event: string
  data: string
}

export class ChatStreamError extends Error {
  readonly event: ChatSseErrorEvent

  constructor(event: ChatSseErrorEvent) {
    super(event.message)
    this.name = 'ChatStreamError'
    this.event = event
  }
}

function parseSseEventBlock(block: string): SseEventBlock | null {
  const lines = block.split(/\r?\n/)
  let event = 'message'
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
      continue
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  return {
    event,
    data: dataLines.join('\n'),
  }
}

function parseSseEventBlocks(buffer: string) {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''

  return {
    blocks: blocks.map(parseSseEventBlock).filter((block): block is SseEventBlock => Boolean(block)),
    rest,
  }
}

export async function streamChat(request: ChatRequest, { signal, onFrame, onError }: ChatStreamOptions = {}) {
  const response = await fetch(getApiUrl(apiPaths.chat), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Chat request failed with status ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Chat response body is empty')
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const frames: ChatSseFrame[] = []
  let buffer = ''

  function handleSseEventBlock(block: SseEventBlock) {
    if (block.event === 'error') {
      const errorEvent = JSON.parse(block.data) as ChatSseErrorEvent
      onError?.(errorEvent)
      throw new ChatStreamError(errorEvent)
    }

    const frame = JSON.parse(block.data) as ChatSseFrame
    frames.push(frame)
    onFrame?.(frame)
  }

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += value
    const parsed = parseSseEventBlocks(buffer)
    buffer = parsed.rest

    for (const block of parsed.blocks) {
      handleSseEventBlock(block)
    }
  }

  const finalBlock = parseSseEventBlock(buffer.trim())

  if (finalBlock) {
    handleSseEventBlock(finalBlock)
  }

  return frames
}

export function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
