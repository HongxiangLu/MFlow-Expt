import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type UIEvent,
  type WheelEvent,
} from 'react'
import { MessageSquare, Send, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { createSessionId, streamBookQuestion } from '../../services'
import type { BookChatRequest } from '../../types'
import styles from './book.module.scss'

type BookAiRole = 'user' | 'assistant'

type BookAiMessage = {
  id: number
  role: BookAiRole
  content: string
  isStreaming?: boolean
}

type BookAiProps = {
  knowledgeBaseId?: string
  bookId?: string
  chapterId?: string
  bookTitle?: string
  chapterTitle?: string
  isBookLoading?: boolean
  bookError?: string | null
}

const autoScrollThreshold = 48
const resumeAutoScrollThreshold = 4
const programmaticScrollResetDelay = 120
const typewriterInterval = 60
const typewriterCharsPerTick = 1
const fallbackErrorMessage = '当前 AI 服务暂时不可用，请稍后重试。'
const markdownCursorMarker = '[[STREAM_CURSOR]]'

const defaultPrompts = [
  '总结当前章节的关键内容',
  '提炼这本书的重要人物和概念',
  '解释这一章最值得关注的观点',
  '给出 3 个可以继续追问的问题',
]

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (typeof error === 'object' && error) {
    const maybeCanceledError = error as { code?: unknown; name?: unknown }

    return maybeCanceledError.code === 'ERR_CANCELED' || maybeCanceledError.name === 'CanceledError'
  }

  return false
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

function renderStreamCursor() {
  return <span className={styles.bookAiStreamCursor} aria-hidden="true" />
}

function renderMarkdownChildrenWithCursor(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'string') {
      if (!child.includes(markdownCursorMarker)) {
        return child
      }

      const parts = child.split(markdownCursorMarker)

      return parts.flatMap((part, index) =>
        index === parts.length - 1 ? [part] : [part, renderStreamCursor()],
      )
    }

    if (isValidElement(child)) {
      const element = child as ReactElement<{ children?: ReactNode }>

      return cloneElement(element, undefined, renderMarkdownChildrenWithCursor(element.props.children))
    }

    return child
  })
}

const markdownComponents = {
  p: ({ children }: { children?: ReactNode }) => <p>{renderMarkdownChildrenWithCursor(children)}</p>,
  h1: ({ children }: { children?: ReactNode }) => <h1>{renderMarkdownChildrenWithCursor(children)}</h1>,
  h2: ({ children }: { children?: ReactNode }) => <h2>{renderMarkdownChildrenWithCursor(children)}</h2>,
  h3: ({ children }: { children?: ReactNode }) => <h3>{renderMarkdownChildrenWithCursor(children)}</h3>,
  li: ({ children }: { children?: ReactNode }) => <li>{renderMarkdownChildrenWithCursor(children)}</li>,
}

function buildBookAiRequest({
  question,
  sessionId,
  knowledgeBaseId,
  bookId,
  chapterId,
}: {
  question: string
  sessionId: string
  knowledgeBaseId?: string
  bookId?: string
  chapterId?: string
}): BookChatRequest {
  return {
    sessionId,
    knowledgeBaseId,
    bookId,
    chapterId,
    question,
  }
}

export default function BookAi({
  knowledgeBaseId,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  isBookLoading,
  bookError,
}: BookAiProps) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<BookAiMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const nextMessageId = useRef(1)
  const sessionIdRef = useRef(createSessionId())
  const chatAbortControllerRef = useRef<AbortController | undefined>(undefined)
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
  const isSubmitDisabled = !query.trim() || isStreaming || isBookLoading || Boolean(bookError)
  const prompts = useMemo(() => {
    if (!chapterTitle) return defaultPrompts

    return [
      `总结《${chapterTitle}》`,
      '列出这一章的关键概念',
      '这章和全书主题有什么关系',
      '基于这一章生成复习问题',
    ]
  }, [chapterTitle])

  useEffect(() => {
    return () => {
      chatAbortControllerRef.current?.abort()

      if (programmaticScrollTimerRef.current !== undefined) {
        window.clearTimeout(programmaticScrollTimerRef.current)
      }

      if (typewriterTimerRef.current !== undefined) {
        window.clearTimeout(typewriterTimerRef.current)
      }
    }
  }, [])

  const scrollChatToBottom = () => {
    const chatContent = chatContentRef.current
    if (!chatContent) return

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
    if (!pendingAutoScrollRef.current) return

    pendingAutoScrollRef.current = false
    scrollChatToBottom()
  }, [messages])

  function handleChatScroll(event: UIEvent<HTMLDivElement>) {
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

  function handleChatWheel(event: WheelEvent<HTMLDivElement>) {
    isProgrammaticScrollRef.current = false

    if (event.deltaY < 0 && isScrollable(event.currentTarget)) {
      shouldAutoScrollRef.current = false
      isUserViewingHistoryRef.current = true
      return
    }

    window.requestAnimationFrame(() => {
      const chatContent = chatContentRef.current
      if (!chatContent) return

      const isAtBottom = isAtScrollBottom(chatContent)
      shouldAutoScrollRef.current = isAtBottom
      isUserViewingHistoryRef.current = !isAtBottom
    })
  }

  function handleManualScrollIntent(event: UIEvent<HTMLDivElement>) {
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

  function updateAssistantMessage(assistantMessageId: number, updater: (message: BookAiMessage) => BookAiMessage) {
    setMessages((currentMessages) =>
      currentMessages.map((message) => (message.id === assistantMessageId ? updater(message) : message)),
    )
  }

  function failAssistantMessage(assistantMessageId: number, message: string) {
    updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
      ...assistantMessage,
      content: assistantMessage.content || message,
      isStreaming: false,
    }))
    setIsStreaming(false)
  }

  function clearTypewriter() {
    if (typewriterTimerRef.current !== undefined) {
      window.clearTimeout(typewriterTimerRef.current)
      typewriterTimerRef.current = undefined
    }

    typewriterQueueRef.current = []
    activeAssistantMessageIdRef.current = undefined
    pendingFinishAssistantMessageIdRef.current = undefined
  }

  function scheduleTypewriter() {
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
        updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
          ...assistantMessage,
          content: `${assistantMessage.content}${nextChunk}`,
        }))
        scheduleTypewriter()
        return
      }

      if (pendingFinishAssistantMessageIdRef.current === assistantMessageId) {
        pendingFinishAssistantMessageIdRef.current = undefined
        activeAssistantMessageIdRef.current = undefined
        queueAutoScroll()
        updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
          ...assistantMessage,
          isStreaming: false,
        }))
        setIsStreaming(false)
      }
    }, typewriterInterval)
  }

  function enqueueTypewriterChunk(assistantMessageId: number, chunk: string) {
    activeAssistantMessageIdRef.current = assistantMessageId
    typewriterQueueRef.current.push(...Array.from(chunk))
    scheduleTypewriter()
  }

  function finishTypewriterWhenDrained(assistantMessageId: number) {
    pendingFinishAssistantMessageIdRef.current = assistantMessageId
    scheduleTypewriter()
  }

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    const submittedQuery = query.trim()
    if (!submittedQuery || isSubmitDisabled) return

    chatAbortControllerRef.current?.abort()
    clearTypewriter()
    chatAbortControllerRef.current = new AbortController()
    shouldAutoScrollRef.current = true
    isUserViewingHistoryRef.current = false
    queueAutoScroll(true)

    const userMessageId = nextMessageId.current
    const assistantMessageId = nextMessageId.current + 1

    nextMessageId.current += 2
    setQuery('')
    setIsStreaming(true)
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: userMessageId, role: 'user', content: submittedQuery },
      { id: assistantMessageId, role: 'assistant', content: '', isStreaming: true },
    ])
    activeAssistantMessageIdRef.current = assistantMessageId

    const request = buildBookAiRequest({
      question: submittedQuery,
      sessionId: sessionIdRef.current,
      knowledgeBaseId,
      bookId,
      chapterId,
    })

    void streamBookQuestion(request, {
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
    })
      .catch((error: unknown) => {
        if (isAbortError(error)) return

        queueAutoScroll()
        clearTypewriter()
        failAssistantMessage(assistantMessageId, fallbackErrorMessage)
      })
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return

    event.preventDefault()
    handleSubmit()
  }

  return (
    <section className={styles.bookAiPanel} aria-label="书籍 AI 对话">
      <div
        className={styles.bookAiContent}
        ref={chatContentRef}
        onScroll={handleChatScroll}
        onWheel={handleChatWheel}
        onPointerDown={handleManualScrollIntent}
        onTouchStart={handleManualScrollIntent}
      >
        {messages.length === 0 ? (
          <div className={styles.bookAiEmpty}>
            <div className={styles.bookAiHeroIcon}>
              <Sparkles size={22} />
            </div>
            <h2>{bookTitle ? `和 AI 讨论《${bookTitle}》` : '和 AI 讨论这本书'}</h2>
            <p>{chapterTitle ? `当前章节：${chapterTitle}` : '当前范围：整本书'}</p>

            <div className={styles.bookAiPromptGrid}>
              {prompts.map((prompt) => (
                <button
                  className={query === prompt ? styles.bookAiPromptActive : undefined}
                  type="button"
                  key={prompt}
                  onClick={() => setQuery(prompt)}
                  disabled={isBookLoading || Boolean(bookError)}
                >
                  <MessageSquare size={15} />
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.bookAiThread}>
            {messages.map((message) => (
              <article
                className={`${styles.bookAiTurn} ${
                  message.role === 'user' ? styles.bookAiUserTurn : styles.bookAiAssistantTurn
                }`}
                key={message.id}
              >
                {message.role === 'assistant' && (
                  <div className={styles.bookAiAvatar}>
                    <Sparkles size={16} />
                  </div>
                )}
                <div className={styles.bookAiBubble}>
                  {message.role === 'assistant' ? (
                    <div className={styles.bookAiMarkdown}>
                      <ReactMarkdown components={markdownComponents}>
                        {message.isStreaming
                          ? `${message.content || '正在分析...'}${markdownCursorMarker}`
                          : message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <form className={styles.bookAiComposer} onSubmit={handleSubmit}>
        <textarea
          aria-label="向书籍 AI 提问"
          value={query}
          rows={1}
          placeholder={bookError ?? (isBookLoading ? '原文加载中' : '向当前书籍提问')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={isBookLoading || Boolean(bookError)}
        />
        <button type="submit" aria-label="发送问题" disabled={isSubmitDisabled}>
          <Send size={17} fill="currentColor" />
        </button>
      </form>
    </section>
  )
}
