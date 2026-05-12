import { apiPaths, bookHttp, getBookApiUrl, type RequestOptions } from './api'
import type {
  BookChatRequest,
  BookChatResponse,
  BookListResponse,
  BookSourceRef,
  BookTextResponse,
  ChatSseErrorEvent,
  ChatSseFrame,
  GraphResponse,
} from '../types'

type ApiEnvelope<T> = {
  data: T
}

type SseEventBlock = {
  event: string
  data: string
}

export type BookListRequestOptions = RequestOptions

export type BookChatStreamOptions = RequestOptions & {
  onFrame?: (frame: ChatSseFrame) => void
  onError?: (event: ChatSseErrorEvent) => void
}

export class BookChatStreamError extends Error {
  readonly event: ChatSseErrorEvent

  constructor(event: ChatSseErrorEvent) {
    super(event.message)
    this.name = 'BookChatStreamError'
    this.event = event
  }
}

type BookTextApiData = Omit<BookTextResponse, 'content' | 'anchors' | 'entities'> &
  Partial<Pick<BookTextResponse, 'anchors' | 'entities'>>

function normalizeBookTextResponse(response: BookTextApiData): BookTextResponse {
  return {
    ...response,
    anchors: response.anchors ?? [],
    entities: response.entities ?? [],
    content: response.markdown,
  }
}

export async function getBookList({ signal }: BookListRequestOptions = {}) {
  const response = await bookHttp.get<ApiEnvelope<BookListResponse>>(apiPaths.bookList, { signal })

  return response.data.data
}

export async function getBookContent(bookId: string, { signal }: RequestOptions = {}) {
  const response = await bookHttp.get<ApiEnvelope<BookTextApiData>>(apiPaths.bookContent(bookId), { signal })

  return normalizeBookTextResponse(response.data.data)
}

export async function getBookChapterContent(chapterId: string, { signal }: RequestOptions = {}) {
  const response = await bookHttp.get<ApiEnvelope<BookTextApiData>>(
    apiPaths.bookChapterContent(chapterId),
    { signal },
  )

  return normalizeBookTextResponse(response.data.data)
}

export async function getBookGraph(bookId: string, { signal }: RequestOptions = {}) {
  const response = await bookHttp.get<ApiEnvelope<GraphResponse>>(apiPaths.bookGraph, {
    signal,
    params: { bookId },
  })

  return response.data.data
}

export async function getBookGraphNodeSources(nodeId: string, bookId: string, { signal }: RequestOptions = {}) {
  const response = await bookHttp.get<ApiEnvelope<BookSourceRef[]>>(apiPaths.bookGraphNodeSources(nodeId), {
    signal,
    params: { bookId },
  })

  return response.data.data
}

export async function askBookQuestion(request: BookChatRequest, { signal }: RequestOptions = {}) {
  const response = await bookHttp.post<ApiEnvelope<BookChatResponse>>(apiPaths.bookChat, request, { signal })

  return response.data.data
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

export async function streamBookQuestion(
  request: BookChatRequest,
  { signal, onFrame, onError }: BookChatStreamOptions = {},
) {
  const response = await fetch(getBookApiUrl(apiPaths.bookChat), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Book chat request failed with status ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Book chat response body is empty')
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const frames: ChatSseFrame[] = []
  let buffer = ''

  function handleSseEventBlock(block: SseEventBlock) {
    if (block.event === 'error') {
      const errorEvent = JSON.parse(block.data) as ChatSseErrorEvent
      onError?.(errorEvent)
      throw new BookChatStreamError(errorEvent)
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
