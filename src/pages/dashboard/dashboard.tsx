import { Children, Fragment, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useLocation } from 'react-router-dom'
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
import Collection3DStage from '../../components/collection-3d-stage/collection-3d-stage'
import KnowledgeGraph from '../../components/knowledge-graph/knowledge-graph'
import { useDialogueStoreController } from '../../store/dialogue-store'
import { artifactFacts, prompts } from '../ai-guide/data'
import { museumCollectionItems } from '../collection/data'
import { exhibitionsModuleMeta } from '../exhibitions/data'
import { searchModuleMeta } from '../search/data'
import { tourModuleMeta } from '../tour/data'
import type { DashboardView, ModuleMeta } from './types'
import mockjpg from '../../../mock/mock.jpg'
import styles from './dashboard.module.scss'

const dashboardNavItems = [
  { label: '藏品', icon: Archive, path: '/dashboard/collection', view: 'collection' as const },
  { label: '检索', icon: Search, path: '/dashboard/search', view: 'search' as const },
  { label: '导览', icon: Map, path: '/dashboard/tour', view: 'tour' as const },
  { label: '展览', icon: UserRound, path: '/dashboard/exhibitions', view: 'exhibitions' as const },
]

const aiGuidePath = '/dashboard/ai-guide'

const moduleMetaMap: Record<Exclude<DashboardView, 'collection' | 'ai-guide'>, ModuleMeta> = {
  search: searchModuleMeta,
  tour: tourModuleMeta,
  exhibitions: exhibitionsModuleMeta,
}

const markdownCursorMarker = '[[STREAM_CURSOR]]'

function getDashboardView(pathname: string): DashboardView {
  const viewMatch = pathname.split('/').pop()
  const validViews = ['collection', 'search', 'tour', 'exhibitions']
  
  if (viewMatch && validViews.includes(viewMatch)) {
    return viewMatch as DashboardView
  }

  return 'ai-guide'
}

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

      return parts.map((part, index) => (
        <Fragment key={`stream-cursor-part-${index}`}>
          {part}
          {index < parts.length - 1 && renderStreamCursor()}
        </Fragment>
      ))
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

type DashboardPageProps = {
  view?: DashboardView
}

export default function DashboardPage({ view }: DashboardPageProps) {
  const { pathname } = useLocation()
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
  const [selectedCollectionId, setSelectedCollectionId] = useState(museumCollectionItems[0].id)
  const currentView = view ?? getDashboardView(pathname)
  const isAiGuideView = currentView === 'ai-guide'
  const isCollectionView = currentView === 'collection'
  const selectedCollectionItem =
    museumCollectionItems.find((item) => item.id === selectedCollectionId) ?? museumCollectionItems[0]
  const activeModuleMeta = !isAiGuideView && !isCollectionView ? moduleMetaMap[currentView] : null

  return (
    <main className={styles.page}>
      <AppHeader />

      <section className={styles.workspace} aria-label="湖南博物院 AI 讲解界面">
        <aside className={styles.leftSidebar}>
          {isAiGuideView && (
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
          )}

          <section className={styles.artifactDetails} aria-label="文物信息">
            {isAiGuideView ? (
              <>
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
              </>
            ) : isCollectionView ? (
              <section className={styles.collectionList} aria-label="藏馆文物列表">
                {museumCollectionItems.map((item) => (
                  <button
                    className={`${styles.collectionItem} ${
                      item.id === selectedCollectionId ? styles.activeCollectionItem : ''
                    }`}
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedCollectionId(item.id)}
                  >
                    <div className={styles.collectionItemHeader}>
                      <h3>{item.name}</h3>
                      <span>{item.badge}</span>
                    </div>
                    <p className={styles.collectionMeta}>{item.meta}</p>
                    <p className={styles.collectionSummary}>{item.summary}</p>
                  </button>
                ))}
              </section>
            ) : (
              <div className={styles.moduleSidebarContent}>
                <div className={styles.titleBlock}>
                  <h2>{activeModuleMeta?.sidebarTitle}</h2>
                  <p>{activeModuleMeta?.sidebarSubtitle}</p>
                </div>

                <section className={styles.introBlock}>
                  <h3>
                    <Sparkles size={14} />
                    模块说明
                  </h3>
                  <p>{activeModuleMeta?.sidebarDescription}</p>
                </section>

                <section className={styles.collectionHighlightsBlock}>
                  <h3>将包含的能力</h3>
                  <div className={styles.collectionHighlightsList}>
                    {activeModuleMeta?.highlights.map((highlight) => <p key={highlight}>{highlight}</p>)}
                  </div>
                </section>
              </div>
            )}
          </section>
        </aside>

        {isAiGuideView ? (
          <>
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
          </>
        ) : isCollectionView ? (
          <>
            <section className={styles.collectionModelPanel} aria-label={`${selectedCollectionItem.name} 3D 展示`}>
              <div className={styles.collectionModelStage}>
                <Collection3DStage modelUrl={selectedCollectionItem.modelUrl} />
              </div>
            </section>

            <aside className={styles.collectionInfoSidebar} aria-label="馆藏文物详情">
              <header className={styles.collectionInfoHeader}>
                <h2>
                  <BookOpen size={16} />
                  文物详情介绍
                </h2>
                <p>{selectedCollectionItem.meta}</p>
              </header>

              <div className={styles.collectionInfoBody}>
                <section className={styles.collectionFactGrid} aria-label="馆藏信息">
                  <article>
                    <span>时代</span>
                    <strong>{selectedCollectionItem.period}</strong>
                  </article>
                  <article>
                    <span>材质</span>
                    <strong>{selectedCollectionItem.material}</strong>
                  </article>
                  <article>
                    <span>来源</span>
                    <strong>{selectedCollectionItem.origin}</strong>
                  </article>
                  <article>
                    <span>展厅</span>
                    <strong>{selectedCollectionItem.hall}</strong>
                  </article>
                  <article>
                    <span>尺寸</span>
                    <strong>{selectedCollectionItem.size}</strong>
                  </article>
                </section>

                <section className={styles.collectionDescriptionBlock}>
                  <h3>内容简介</h3>
                  {selectedCollectionItem.description.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>

                <section className={styles.collectionHighlightsBlock}>
                  <h3>解读重点</h3>
                  <div className={styles.collectionHighlightsList}>
                    {selectedCollectionItem.highlights.map((highlight) => (
                      <p key={highlight}>{highlight}</p>
                    ))}
                  </div>
                </section>
              </div>
            </aside>
          </>
        ) : (
          <>
            <section className={styles.modulePlaceholderPanel} aria-label={`${activeModuleMeta?.label}模块主区域`}>
              <header className={styles.collectionInfoHeader}>
                <h2>
                  <Sparkles size={16} />
                  {activeModuleMeta?.label}
                </h2>
                <p>{activeModuleMeta?.stageTitle}</p>
              </header>

              <div className={styles.modulePlaceholderStage}>
                <span className={styles.modulePlaceholderBadge}>{activeModuleMeta?.label}</span>
                <h3>{activeModuleMeta?.stageTitle}</h3>
                <p>{activeModuleMeta?.stageDescription}</p>
              </div>
            </section>

            <aside className={styles.collectionInfoSidebar} aria-label={`${activeModuleMeta?.label}模块详情`}>
              <header className={styles.collectionInfoHeader}>
                <h2>
                  <BookOpen size={16} />
                  {activeModuleMeta?.detailTitle}
                </h2>
                <p>{activeModuleMeta?.sidebarSubtitle}</p>
              </header>

              <div className={styles.collectionInfoBody}>
                <section className={styles.collectionDescriptionBlock}>
                  <h3>模块简介</h3>
                  <p>{activeModuleMeta?.detailIntro}</p>
                </section>

                <section className={styles.collectionHighlightsBlock}>
                  <h3>后续建议</h3>
                  <div className={styles.collectionHighlightsList}>
                    {activeModuleMeta?.highlights.map((highlight) => <p key={highlight}>{highlight}</p>)}
                  </div>
                </section>
              </div>
            </aside>
          </>
        )}
      </section>

      {isImagePreviewOpen && isAiGuideView && (
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
          {dashboardNavItems.slice(0, 2).map((item) => (
            <Link
              className={currentView === item.view ? styles.activeNavItem : undefined}
              key={item.path}
              to={item.path}
              aria-current={currentView === item.view ? 'page' : undefined}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </Link>
          ))}

          <Link
            className={`${styles.aiNavButton} ${isAiGuideView ? styles.activeNavItem : ''}`}
            to={aiGuidePath}
            aria-current={isAiGuideView ? 'page' : undefined}
          >
            <span className={styles.aiNavIcon}>
              <AudioLines size={24} />
            </span>
            <span>AI讲解</span>
          </Link>

          {dashboardNavItems.slice(2).map((item) => (
            <Link
              className={currentView === item.view ? styles.activeNavItem : undefined}
              key={item.path}
              to={item.path}
              aria-current={currentView === item.view ? 'page' : undefined}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </main>
  )
}
