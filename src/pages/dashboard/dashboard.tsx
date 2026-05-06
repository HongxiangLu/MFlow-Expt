import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type UIEvent, type WheelEvent } from 'react'
import {
  Archive,
  AudioLines,
  BookOpen,
  Box,
  Expand,
  Map,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import AppHeader from '../../components/app-header/app-header'
import KnowledgeGraph from '../../components/knowledge-graph/knowledge-graph'
import mockjpg from '../../../mock/mock.jpg'
import mockSseText from '../../../mock/mock.txt?raw'
import styles from './dashboarad.module.scss'

const artifactFacts = [
  { label: '文物编号', value: 'HNM-2024-0156' },
  { label: '年代', value: '西周早期 (约公元前1046-前977)' },
  { label: '材质', value: '青铜 (铜锡合金)' },
  { label: '尺寸', value: '通高28.5cm, 口径22.4cm' },
  { label: '重量', value: '2.85 kg' },
  { label: '出土地点', value: '湖南省长沙市' },
  { label: '收藏单位', value: '湖南博物院' },
]

const prompts = [
  '该文物是属于西周早期的吗？',
  '该文物的材质和铸造工艺有什么特点？',
  '可不可以根据其纹饰推测当时的社会信仰?',
  '铭文的内容主要记载了什么事件？',
]

const navItems = [
  { label: '藏品', icon: Archive },
  { label: '检索', icon: Search },
  { label: '导览', icon: Map },
  { label: '我的', icon: UserRound },
]

type ChatMessage = {
  id: number
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

type SseFrame = {
  chunk: string
  finish_reason: null | 'stop'
}

const streamChunkMinSize = 1
const streamChunkMaxSize = 2
const autoScrollThreshold = 48
const resumeAutoScrollThreshold = 4
const programmaticScrollResetDelay = 120

function parseMockSseFrames(sseText: string) {
  return sseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()) as SseFrame)
}

function splitStreamChunk(chunk: string) {
  const chars = Array.from(chunk)
  const chunks: string[] = []
  let cursor = 0

  while (cursor < chars.length) {
    const size = cursor % 3 === 0 ? streamChunkMinSize : streamChunkMaxSize
    chunks.push(chars.slice(cursor, cursor + size).join(''))
    cursor += size
  }

  return chunks
}

function createDisplayFrames(frames: SseFrame[]) {
  return frames.flatMap((frame) => {
    if (frame.finish_reason === 'stop') {
      return [frame]
    }

    return splitStreamChunk(frame.chunk).map((chunk) => ({ chunk, finish_reason: null }))
  })
}

function getStreamDelay(frame: SseFrame) {
  if (frame.finish_reason === 'stop') {
    return 0
  }

  if (frame.chunk.includes('\n\n')) {
    return 780
  }

  if (/[。！？!?；;：:]$/.test(frame.chunk.trim())) {
    return 520
  }

  if (/[，,、]$/.test(frame.chunk.trim())) {
    return 280
  }

  return 95
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

const mockSseFrames = createDisplayFrames(parseMockSseFrames(mockSseText))

function createMockSseStream(onFrame: (frame: SseFrame) => void) {
  let cursor = 0
  let timerId: number | undefined

  const playNextFrame = () => {
    timerId = undefined

    if (cursor >= mockSseFrames.length) {
      onFrame({ chunk: '', finish_reason: 'stop' })
      return
    }

    const frame = mockSseFrames[cursor]
    cursor += 1
    onFrame(frame)

    if (frame.finish_reason === 'stop') {
      return
    }

    timerId = window.setTimeout(playNextFrame, getStreamDelay(frame))
  }

  timerId = window.setTimeout(playNextFrame, 700)

  return () => {
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      timerId = undefined
    }
  }
}

export default function MuseumAiPage() {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false)
  const nextMessageId = useRef(1)
  const cancelStreamRef = useRef<(() => void) | undefined>(undefined)
  const chatContentRef = useRef<HTMLDivElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const isUserViewingHistoryRef = useRef(false)
  const isProgrammaticScrollRef = useRef(false)
  const pendingAutoScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const programmaticScrollTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      cancelStreamRef.current?.()
      if (programmaticScrollTimerRef.current !== undefined) {
        window.clearTimeout(programmaticScrollTimerRef.current)
      }
    }
  }, [])

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const submittedQuery = query.trim()

    if (!submittedQuery || isStreaming) {
      return
    }

    cancelStreamRef.current?.()
    cancelStreamRef.current = undefined
    shouldAutoScrollRef.current = true
    isUserViewingHistoryRef.current = false
    queueAutoScroll(true)

    const userMessageId = nextMessageId.current
    const assistantMessageId = nextMessageId.current + 1
    nextMessageId.current += 2

    setMessages((currentMessages) => [
      ...currentMessages,
      { id: userMessageId, role: 'user', content: submittedQuery },
      { id: assistantMessageId, role: 'assistant', content: '', isStreaming: true },
    ])
    setQuery('')
    setIsStreaming(true)

    cancelStreamRef.current = createMockSseStream((frame) => {
      if (frame.finish_reason === 'stop') {
        cancelStreamRef.current?.()
        cancelStreamRef.current = undefined
        queueAutoScroll()

        setIsStreaming(false)
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessageId ? { ...message, isStreaming: false } : message,
          ),
        )
        return
      }

      queueAutoScroll()
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId ? { ...message, content: `${message.content}${frame.chunk}` } : message,
        ),
      )
    })
  }

  return (
    <main className={styles.page}>
      <AppHeader />

      <section className={styles.workspace} aria-label="湖南博物院 AI 讲解界面">
        <aside className={styles.leftSidebar}>
          <section className={styles.artifactCard} aria-label="文物图片">
            <img src={mockjpg} alt="杜工部草堂诗笺" decoding="async" />
            <div className={styles.artifactOverlay} />
            <div className={styles.cardActions}>
              <button type="button" aria-label="放大查看" onClick={() => setIsImagePreviewOpen(true)}>
                <Expand size={16} />
              </button>
            </div>
            <div className={styles.cardBadges}>
              <span>馆藏珍品</span>
              <button type="button">
                <Box size={12} />
                3D 检视
              </button>
            </div>
          </section>

          <section className={styles.artifactDetails} aria-label="文物信息">
            <div className={styles.titleBlock}>
              <h2>杜工部草堂诗笺</h2>
              <p>中国古代典籍 | 宋代刻本</p>
            </div>

            <dl className={styles.factList}>
              {artifactFacts.map((fact) => (
                <div className={styles.factRow} key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>

            <section className={styles.introBlock}>
              <h3>
                <BookOpen size={14} />
                文物简介
              </h3>
              <p>
              《杜工部草堂诗笺》作为南宋时期杜诗学研究的巅峰之作，由鲁訔编定、蔡梦弼会笺，其四十卷的浩繁篇幅不仅系统性地整理了“千家注杜”的宋代学术成果，更在版本史上具有举足轻重的地位。该书在编排上独具匠心，打破了旧有的题材分类限制，采取分体编年之法，力求在还原杜甫颠沛流离一生轨迹的同时，通过对唐代典章制度、地理沿革及史实的细致考释，精准解读杜诗“诗史”的深刻内涵。书中汇集了王洙、赵彦材等名家的注评，保留了大量珍贵的散佚文献，其宋刊建安本更以版刻精美、校勘严谨著称，不仅是后世研究杜甫文学艺术与精神世界的基石，亦是中华典籍中不可多得的艺术瑰宝。
              </p>
            </section>
          </section>
        </aside>

        <section className={styles.chatPanel} aria-label="与 AI 馆长对话">
          <div
            className={styles.chatContent}
            ref={chatContentRef}
            onScroll={handleChatScroll}
            onWheel={handleChatWheel}
            onPointerDown={handleManualScrollIntent}
            onTouchStart={handleManualScrollIntent}
          >
            {messages.length === 0 ? (
              <>
                <header className={styles.chatHero}>
                  <h2>
                    <Sparkles size={20} />
                    与 AI 馆长对话
                    <Sparkles size={20} />
                  </h2>
                  <p>探索文物背后的历史，让 AI 为您深入解读文化遗产</p>
                </header>

                <div className={styles.aiMessage}>
                  <div className={styles.aiAvatar}>
                    <Sparkles size={20} />
                  </div>
                  <p>
                    您好！我是您的专属文物AI讲解员。关于这件
                    <strong>杜工部草堂诗笺</strong>
                    ，您可以向我提问它的历史背景、工艺特点或文化内涵等问题。以下是一些大家常问的问题，您可以直接点击提问：
                  </p>
                </div>

                <div className={styles.promptGrid}>
                  {prompts.map((prompt) => (
                    <button
                      className={query === prompt ? styles.activePrompt : undefined}
                      type="button"
                      key={prompt}
                      onClick={() => setQuery(prompt)}
                    >
                      <MessageSquare size={16} />
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.chatThread}>
                {messages.map((message) => (
                  <article
                    className={`${styles.chatTurn} ${
                      message.role === 'user' ? styles.userTurn : styles.assistantTurn
                    }`}
                    key={message.id}
                  >
                    {message.role === 'assistant' && (
                      <div className={styles.aiAvatar}>
                        <Sparkles size={20} />
                      </div>
                    )}
                    <div className={styles.messageBubble}>
                      <p>
                        {message.content}
                        {message.isStreaming && <span className={styles.streamCursor} aria-hidden="true" />}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={handleSubmit}>
            <input
              type="text"
              aria-label="向 AI 馆长提问"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="该文物是属于西周早期的吗？"
              autoComplete="off"
            />
            <button type="submit" aria-label="发送问题" disabled={!query.trim() || isStreaming}>
              <Send size={18} fill="currentColor" />
            </button>
          </form>
        </section>

        <aside className={styles.rightSidebar} aria-label="知识图谱">
          <header className={styles.graphHeader}>
            <h2>
              <Sparkles size={16} />
              知识图谱
            </h2>
            <p>文物关联知识网络可视化</p>
          </header>

          <div className={styles.graphArea}>
            <KnowledgeGraph />
          </div>

          <section className={styles.graphLegend} aria-label="图谱说明">
            <h3>图谱说明</h3>
            <p>
              <span className={styles.centerDot} />
              中心文物本体
            </p>
            <p>
              <span className={styles.nodeDot} />
              可拓展属性节点 (点击探索)
            </p>
          </section>
        </aside>
      </section>

      {isImagePreviewOpen && (
        <div className={styles.imagePreviewBackdrop} role="presentation" onClick={() => setIsImagePreviewOpen(false)}>
          <section
            className={styles.imagePreviewDialog}
            role="dialog"
            aria-modal="true"
            aria-label="放大查看文物图片"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" aria-label="关闭放大图片" onClick={() => setIsImagePreviewOpen(false)}>
              <X size={18} />
            </button>
            <img src={mockjpg} alt="杜工部草堂诗笺" decoding="async" />
          </section>
        </div>
      )}

      <nav className={styles.bottomNav} aria-label="底部导航">
        <div className={styles.navInner}>
          {navItems.slice(0, 2).map((item) => (
            <button type="button" key={item.label}>
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}

          <button className={styles.aiNavButton} type="button" aria-current="page">
            <span>
              <AudioLines size={24} />
            </span>
            <strong>AI讲解</strong>
          </button>

          {navItems.slice(2).map((item) => (
            <button type="button" key={item.label}>
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </main>
  )
}
