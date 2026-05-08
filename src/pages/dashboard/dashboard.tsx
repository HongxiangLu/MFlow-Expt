import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
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
import { useDialogueStoreController } from '../../store/dialogue-store'
import mockjpg from '../../../mock/mock.jpg'
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
  { label: '展览', icon: UserRound },
]

const markdownCursorMarker = '[[STREAM_CURSOR]]'

function renderStreamCursor() {
  return <span className={styles.streamCursor} aria-hidden="true" />
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

export default function MuseumAiPage() {
  const {
    query,
    messages,
    isStreaming,
    setQuery,
    chatContentRef,
    handleChatScroll,
    handleChatWheel,
    handleManualScrollIntent,
    handleSubmit,
  } = useDialogueStoreController()
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false)

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
                      {message.role === 'assistant' ? (
                        <div className={styles.markdownMessage}>
                          <ReactMarkdown components={markdownComponents}>
                            {message.isStreaming ? `${message.content}${markdownCursorMarker}` : message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p>
                          {message.content}
                          {message.isStreaming && <span className={styles.streamCursor} aria-hidden="true" />}
                        </p>
                      )}
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
