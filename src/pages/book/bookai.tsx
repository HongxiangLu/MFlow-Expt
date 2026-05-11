import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent, type WheelEvent } from 'react'
import { MessageSquare, Send, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { createSessionId, streamChat } from '../../services'
import styles from './book.module.scss'

type BookAiRole = 'user' | 'assistant'

type BookAiMessage = {
  id: number
  role: BookAiRole
  content: string
  isStreaming?: boolean
}

type BookAiProps = {
  bookTitle?: string
  chapterTitle?: string
  bookContent?: string
  isBookLoading?: boolean
  bookError?: string | null
}

type BookAiChatRequest = {
  query: string
  session_id: string
}

const autoScrollThreshold = 48
const resumeAutoScrollThreshold = 4
const programmaticScrollResetDelay = 120
const fallbackErrorMessage = '当前 AI 服务暂时不可用，请稍后重试。'
const excerptLength = 3600

const defaultPrompts = [
  '总结当前章节的关键内容',
  '提炼这本书的重要人物和概念',
  '解释这一章最值得关注的观点',
  '给出 3 个可以继续追问的问题',
]

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

function normalizeMarkdownText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function getChapterTitleCandidates(chapterTitle?: string) {
  if (!chapterTitle) return []

  const title = chapterTitle.trim()
  const shortTitle = title.split(/\s+/).at(-1)

  return Array.from(new Set([title, shortTitle].filter((item): item is string => Boolean(item))))
}

function extractChapterExcerpt(bookContent?: string, chapterTitle?: string) {
  if (!bookContent) return ''

  const content = normalizeMarkdownText(bookContent)
  const candidates = getChapterTitleCandidates(chapterTitle)

  if (candidates.length === 0) {
    return content.slice(0, excerptLength)
  }

  const lines = content.split('\n')
  const startIndex = lines.findIndex((line) => {
    const headingText = line.replace(/^#{1,6}\s*/, '').trim()
    if (!headingText) return false

    return candidates.some(
      (candidate) =>
        headingText === candidate || headingText.includes(candidate) || candidate.includes(headingText),
    )
  })

  if (startIndex < 0) {
    return content.slice(0, excerptLength)
  }

  const endIndex = lines.findIndex((line, index) => index > startIndex && /^#{1,6}\s+/.test(line))
  const chapterLines = lines.slice(startIndex, endIndex > startIndex ? endIndex : undefined)

  return chapterLines.join('\n').slice(0, excerptLength)
}

function buildBookAiRequest({
  question,
  bookTitle,
  chapterTitle,
  bookContent,
  sessionId,
}: {
  question: string
  bookTitle?: string
  chapterTitle?: string
  bookContent?: string
  sessionId: string
}): BookAiChatRequest {
  const excerpt = extractChapterExcerpt(bookContent, chapterTitle)
  const context = [
    '你是一个书籍阅读 AI 助手。请基于给定书籍上下文回答用户问题；如果上下文不足，请明确说明。',
    bookTitle ? `书名：${bookTitle}` : '',
    chapterTitle ? `当前章节：${chapterTitle}` : '',
    excerpt ? `原文片段：\n${excerpt}` : '',
    `用户问题：${question}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    query: context,
    session_id: sessionId,
  }
}

export default function BookAi({ bookTitle, chapterTitle, bookContent, isBookLoading, bookError }: BookAiProps) {
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

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    const submittedQuery = query.trim()
    if (!submittedQuery || isSubmitDisabled) return

    chatAbortControllerRef.current?.abort()
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

    const request = buildBookAiRequest({
      question: submittedQuery,
      bookTitle,
      chapterTitle,
      bookContent,
      sessionId: sessionIdRef.current,
    })

    void streamChat(request, {
      signal: chatAbortControllerRef.current.signal,
      onFrame: (frame) => {
        if (frame.chunk) {
          queueAutoScroll()
          updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
            ...assistantMessage,
            content: `${assistantMessage.content}${frame.chunk}`,
          }))
        }

        if (frame.finish_reason === 'stop') {
          chatAbortControllerRef.current = undefined
          queueAutoScroll()
          updateAssistantMessage(assistantMessageId, (assistantMessage) => ({
            ...assistantMessage,
            isStreaming: false,
          }))
          setIsStreaming(false)
        }
      },
      onError: (errorEvent) => {
        queueAutoScroll()
        failAssistantMessage(assistantMessageId, errorEvent.message)
      },
    }).catch((error: unknown) => {
      if (isAbortError(error)) return

      queueAutoScroll()
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
                      <ReactMarkdown>{message.content || '正在分析...'}</ReactMarkdown>
                      {message.isStreaming && <span className={styles.bookAiStreamCursor} aria-hidden="true" />}
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
