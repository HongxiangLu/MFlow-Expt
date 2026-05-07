import { useEffect, useLayoutEffect, useRef, type FormEvent, type UIEvent, type WheelEvent } from 'react'
import { create } from 'zustand'

import { createSessionId, streamChat } from '../services'
import { requestKnowledgeGraph } from './graph-store'

export type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

type DialogueStore = {
  query: string
  messages: ChatMessage[]
  isStreaming: boolean
  setQuery: (query: string) => void
  submitMessage: (content: string, userMessageId: number, assistantMessageId: number) => void
  appendAssistantChunk: (assistantMessageId: number, chunk: string) => void
  finishAssistantMessage: (assistantMessageId: number) => void
  failAssistantMessage: (assistantMessageId: number, message: string) => void
  resetDialogue: () => void
}

const initialDialogueState = {
  query: '',
  messages: [] as ChatMessage[],
  isStreaming: false,
}

const autoScrollThreshold = 48
const resumeAutoScrollThreshold = 4
const programmaticScrollResetDelay = 120
const typewriterInterval = 60
const typewriterCharsPerTick = 1

const fallbackErrorMessage = '抱歉，当前服务暂时不可用，请稍后重试。'

const useDialogueStore = create<DialogueStore>((set) => ({
  ...initialDialogueState,
  setQuery: (query) => set({ query }),
  submitMessage: (content, userMessageId, assistantMessageId) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: userMessageId, role: 'user', content },
        { id: assistantMessageId, role: 'assistant', content: '', isStreaming: true },
      ],
      query: '',
      isStreaming: true,
    })),
  appendAssistantChunk: (assistantMessageId, chunk) =>
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantMessageId ? { ...message, content: `${message.content}${chunk}` } : message,
      ),
    })),
  finishAssistantMessage: (assistantMessageId) =>
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((message) =>
        message.id === assistantMessageId ? { ...message, isStreaming: false } : message,
      ),
    })),
  failAssistantMessage: (assistantMessageId, errorMessage) =>
    set((state) => ({
      isStreaming: false,
      messages: state.messages.map((message) => {
        if (message.id !== assistantMessageId) {
          return message
        }

        return {
          ...message,
          content: message.content || errorMessage,
          isStreaming: false,
        }
      }),
    })),
  resetDialogue: () => set(initialDialogueState),
}))

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= autoScrollThreshold
}

function isAtScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= resumeAutoScrollThreshold
}

function isScrollable(element: HTMLElement) {
  return element.scrollHeight > element.clientHeight + 1
}

export function useDialogueStoreController() {
  const query = useDialogueStore((state) => state.query)
  const messages = useDialogueStore((state) => state.messages)
  const isStreaming = useDialogueStore((state) => state.isStreaming)
  const setQuery = useDialogueStore((state) => state.setQuery)
  const submitMessage = useDialogueStore((state) => state.submitMessage)
  const appendAssistantChunk = useDialogueStore((state) => state.appendAssistantChunk)
  const finishAssistantMessage = useDialogueStore((state) => state.finishAssistantMessage)
  const failAssistantMessage = useDialogueStore((state) => state.failAssistantMessage)
  const resetDialogue = useDialogueStore((state) => state.resetDialogue)
  const nextMessageId = useRef(1)
  const sessionIdRef = useRef(createSessionId())
  const chatAbortControllerRef = useRef<AbortController | undefined>(undefined)
  const graphAbortControllerRef = useRef<AbortController | undefined>(undefined)
  const chatContentRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const isUserViewingHistoryRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const pendingAutoScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const programmaticScrollTimerRef = useRef<number | undefined>(undefined)
  const typewriterQueueRef = useRef<string[]>([])
  const typewriterTimerRef = useRef<number | undefined>(undefined)
  const activeAssistantMessageIdRef = useRef<number | undefined>(undefined)
  const pendingFinishAssistantMessageIdRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      chatAbortControllerRef.current?.abort()
      graphAbortControllerRef.current?.abort()

      if (programmaticScrollTimerRef.current !== undefined) {
        window.clearTimeout(programmaticScrollTimerRef.current)
      }

      if (typewriterTimerRef.current !== undefined) {
        window.clearTimeout(typewriterTimerRef.current)
      }

      resetDialogue()
    }
  }, [resetDialogue])

  const scrollChatToBottom = () => {
    const chatContent = chatContentRef.current

    if (!chatContent) {
      return
    }

    isProgrammaticScrollRef.current = true
    chatContent.scrollTop = chatContent.scrollHeight
    lastScrollTopRef.current = chatContent.scrollTop

    if (programmaticScrollTimerRef.current !== undefined) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }

    programmaticScrollTimerRef.current = window.setTimeout(() => {
      isProgrammaticScrollRef.current = false
      programmaticScrollTimerRef.current = undefined
    }, programmaticScrollResetDelay)
  }

  const queueAutoScroll = (force = false) => {
    const chatContent = chatContentRef.current

    pendingAutoScrollRef.current =
      force ||
      Boolean(chatContent && !isUserViewingHistoryRef.current && shouldAutoScrollRef.current && isNearScrollBottom(chatContent))
  }

  useLayoutEffect(() => {
    if (!pendingAutoScrollRef.current) {
      return
    }

    pendingAutoScrollRef.current = false
    scrollChatToBottom()
  }, [messages])

  const handleChatScroll = (event: UIEvent<HTMLDivElement>) => {
    if (isProgrammaticScrollRef.current) {
      lastScrollTopRef.current = event.currentTarget.scrollTop
      return
    }

    const currentScrollTop = event.currentTarget.scrollTop
    const isScrollingUp = currentScrollTop < lastScrollTopRef.current
    const isAtBottom = isAtScrollBottom(event.currentTarget)

    lastScrollTopRef.current = currentScrollTop

    if (isScrollingUp && isScrollable(event.currentTarget)) {
      shouldAutoScrollRef.current = false
      isUserViewingHistoryRef.current = true
      return
    }

    if (isUserViewingHistoryRef.current) {
      shouldAutoScrollRef.current = isAtBottom
      isUserViewingHistoryRef.current = !isAtBottom
      return
    }

    const isNearBottom = isNearScrollBottom(event.currentTarget)
    shouldAutoScrollRef.current = isNearBottom
    isUserViewingHistoryRef.current = !isNearBottom
  }

  const handleChatWheel = (event: WheelEvent<HTMLDivElement>) => {
    isProgrammaticScrollRef.current = false

    if (event.deltaY < 0 && isScrollable(event.currentTarget)) {
      shouldAutoScrollRef.current = false
      isUserViewingHistoryRef.current = true
      return
    }

    window.requestAnimationFrame(() => {
      const chatContent = chatContentRef.current

      if (!chatContent) {
        return
      }

      const isAtBottom = isAtScrollBottom(chatContent)
      shouldAutoScrollRef.current = isAtBottom
      isUserViewingHistoryRef.current = !isAtBottom
    })
  }

  const handleManualScrollIntent = (event: UIEvent<HTMLDivElement>) => {
    isProgrammaticScrollRef.current = false

    if (isScrollable(event.currentTarget)) {
      shouldAutoScrollRef.current = false
      isUserViewingHistoryRef.current = true
    }

    if (programmaticScrollTimerRef.current !== undefined) {
      window.clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = undefined
    }
  }

  const clearTypewriter = () => {
    if (typewriterTimerRef.current !== undefined) {
      window.clearTimeout(typewriterTimerRef.current)
      typewriterTimerRef.current = undefined
    }

    typewriterQueueRef.current = []
    activeAssistantMessageIdRef.current = undefined
    pendingFinishAssistantMessageIdRef.current = undefined
  }

  const scheduleTypewriter = () => {
    if (typewriterTimerRef.current !== undefined) {
      return
    }

    typewriterTimerRef.current = window.setTimeout(() => {
      typewriterTimerRef.current = undefined

      const assistantMessageId = activeAssistantMessageIdRef.current

      if (assistantMessageId === undefined) {
        return
      }

      const nextChunk = typewriterQueueRef.current.splice(0, typewriterCharsPerTick).join('')

      if (nextChunk) {
        queueAutoScroll()
        appendAssistantChunk(assistantMessageId, nextChunk)
        scheduleTypewriter()
        return
      }

      if (pendingFinishAssistantMessageIdRef.current === assistantMessageId) {
        pendingFinishAssistantMessageIdRef.current = undefined
        activeAssistantMessageIdRef.current = undefined
        queueAutoScroll()
        finishAssistantMessage(assistantMessageId)
      }
    }, typewriterInterval)
  }

  const enqueueTypewriterChunk = (assistantMessageId: number, chunk: string) => {
    activeAssistantMessageIdRef.current = assistantMessageId
    typewriterQueueRef.current.push(...Array.from(chunk))
    scheduleTypewriter()
  }

  const finishTypewriterWhenDrained = (assistantMessageId: number) => {
    pendingFinishAssistantMessageIdRef.current = assistantMessageId
    scheduleTypewriter()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const submittedQuery = query.trim()

    if (!submittedQuery || isStreaming) {
      return
    }

    chatAbortControllerRef.current?.abort()
    graphAbortControllerRef.current?.abort()
    clearTypewriter()
    chatAbortControllerRef.current = new AbortController()
    graphAbortControllerRef.current = new AbortController()
    shouldAutoScrollRef.current = true
    isUserViewingHistoryRef.current = false
    queueAutoScroll(true)

    const userMessageId = nextMessageId.current
    const assistantMessageId = nextMessageId.current + 1
    const request = {
      query: submittedQuery,
      session_id: sessionIdRef.current,
    }

    nextMessageId.current += 2
    submitMessage(submittedQuery, userMessageId, assistantMessageId)
    activeAssistantMessageIdRef.current = assistantMessageId

    void requestKnowledgeGraph(request, graphAbortControllerRef.current.signal)

    void streamChat(request, {
      signal: chatAbortControllerRef.current.signal,
      onFrame: (frame) => {
        if (frame.chunk) {
          queueAutoScroll()
          enqueueTypewriterChunk(assistantMessageId, frame.chunk)
        }

        if (frame.finish_reason === 'stop') {
          chatAbortControllerRef.current = undefined
          queueAutoScroll()
          finishTypewriterWhenDrained(assistantMessageId)
        }
      },
      onError: (errorEvent) => {
        queueAutoScroll()
        clearTypewriter()
        failAssistantMessage(assistantMessageId, errorEvent.message)
      },
    }).catch((error: unknown) => {
      if (isAbortError(error)) {
        return
      }

      queueAutoScroll()
      clearTypewriter()
      failAssistantMessage(assistantMessageId, fallbackErrorMessage)
    })
  }

  return {
    query,
    messages,
    isStreaming,
    setQuery,
    chatContentRef,
    handleChatScroll,
    handleChatWheel,
    handleManualScrollIntent,
    handleSubmit,
  }
}
