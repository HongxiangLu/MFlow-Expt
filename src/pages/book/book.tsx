import { useCallback, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { BookOpen, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import AppHeader from '../../components/app-header/app-header'
import BookKnowledgeGraph from '../../components/book-knowledge-graph/book-knowledge-graph'
import BookAi from './bookai'
import { useBookStoreController } from '../../store/book'
import { bookGraphMockMap } from '../../../mock/BOOK/book-graph'
import type { GraphNode } from '../../types'
import styles from './book.module.scss'

type BookWorkspaceStyle = CSSProperties & {
  '--right-column-width': string
}

type CenterTab = 'reader' | 'ai'

const rightColumnMinWidth = 260
const markdownHeadingSelector = 'h1, h2, h3, h4, h5, h6'

function clampRightColumnWidth(width: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(rightColumnMinWidth, width))
}

export default function BookPage() {
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [rightColumnWidth, setRightColumnWidth] = useState(440)
  const [activeCenterTab, setActiveCenterTab] = useState<CenterTab>('reader')
  const workspaceRef = useRef<HTMLElement>(null)
  const {
    books,
    expandedBookIds,
    selectedBookId,
    selectedChapterId,
    bookText,
    isBookListLoading,
    isBookTextLoading,
    bookListError,
    bookTextError,
    centerColumnRef,
    handleSelectBook,
    handleSelectChapter,
  } = useBookStoreController()
  const selectedBook = books.find((book) => book.id === selectedBookId)
  const selectedChapterTitle = selectedBook?.chapters.find((chapter) => chapter.id === selectedChapterId)?.title
  const selectedGraph = selectedBookId ? (bookGraphMockMap[selectedBookId] ?? null) : null

  const handleFocusGraphNode = useCallback(
    (node: GraphNode) => {
      setActiveCenterTab('reader')

      window.requestAnimationFrame(() => {
        const centerColumn = centerColumnRef.current
        if (!centerColumn) return

        const headings = Array.from(centerColumn.querySelectorAll(markdownHeadingSelector))
        const nodeLabel = node.label.trim()
        const targetHeading = headings.find((heading) => {
          const headingText = heading.textContent?.trim()
          if (!headingText) return false

          return headingText === nodeLabel || headingText.includes(nodeLabel) || nodeLabel.includes(headingText)
        })

        targetHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [centerColumnRef],
  )

  function handleRightResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()

    const startX = event.clientX
    const startWidth = rightColumnWidth
    let latestWidth = startWidth
    const workspace = workspaceRef.current
    const workspaceWidth = workspace?.getBoundingClientRect().width ?? startWidth
    const maxWidth = Math.max(rightColumnMinWidth, workspaceWidth - (isLeftCollapsed ? 0 : 240))

    workspace?.classList.add(styles.rightResizing)

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = startWidth + startX - moveEvent.clientX
      latestWidth = clampRightColumnWidth(Math.round(nextWidth), maxWidth)
      workspace?.style.setProperty('--right-column-width', `${latestWidth}px`)
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      workspace?.classList.remove(styles.rightResizing)
      setRightColumnWidth(latestWidth)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
  }

  return (
    <main className={styles.page}>
      <AppHeader title="Book" subtitle="MUSEUM COLLECTION" status="Book Page" />

      <section
        ref={workspaceRef}
        className={`${styles.workspace} ${isLeftCollapsed ? styles.leftCollapsed : ''}`}
        style={{ '--right-column-width': `${rightColumnWidth}px` } as BookWorkspaceStyle}
        aria-label="Book workspace"
      >
        <button
          className={styles.restoreLeftButton}
          type="button"
          aria-label="Show left column"
          onClick={() => setIsLeftCollapsed(false)}
        >
          <ChevronRight size={18} />
        </button>

        <aside className={styles.leftColumn} aria-label="Book left column" aria-hidden={isLeftCollapsed}>
          <div className={styles.bookListHeader}>
            <h2>图书</h2>
            <span>{books.length}</span>
          </div>

          <div className={styles.bookList} aria-busy={isBookListLoading}>
            {isBookListLoading && <div className={styles.bookListState}>加载中</div>}
            {!isBookListLoading && bookListError && <div className={styles.bookListState}>{bookListError}</div>}
            {!isBookListLoading && !bookListError && books.length === 0 && (
              <div className={styles.bookListState}>暂无图书</div>
            )}

            {!isBookListLoading &&
              !bookListError &&
              books.map((book) => (
                <section className={styles.bookGroup} key={book.id}>
                  <button
                    className={`${styles.bookTitleButton} ${selectedBookId === book.id ? styles.bookTitleButtonActive : ''}`}
                    type="button"
                    aria-expanded={expandedBookIds.has(book.id)}
                    aria-controls={`book-chapters-${book.id}`}
                    onClick={() => handleSelectBook(book.id)}
                  >
                    <span>{book.title}</span>
                    {expandedBookIds.has(book.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  <div
                    className={`${styles.chapterList} ${expandedBookIds.has(book.id) ? styles.chapterListOpen : ''}`}
                    id={`book-chapters-${book.id}`}
                  >
                    {book.chapters.map((chapter) => (
                      <button
                        className={`${styles.chapterButton} ${selectedChapterId === chapter.id ? styles.chapterButtonActive : ''}`}
                        type="button"
                        key={chapter.id}
                        tabIndex={expandedBookIds.has(book.id) ? 0 : -1}
                        onClick={() => handleSelectChapter(book, chapter)}
                      >
                        {chapter.title}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
          </div>

          <button
            className={styles.leftCollapseButton}
            type="button"
            aria-label="Hide left column"
            aria-expanded={!isLeftCollapsed}
            onClick={() => setIsLeftCollapsed(true)}
          />
        </aside>
        <section className={styles.centerColumn} aria-label="Book center column">
          <div className={styles.centerTabs} role="tablist" aria-label="中间栏视图">
            <button
              className={`${styles.centerTabButton} ${activeCenterTab === 'reader' ? styles.centerTabButtonActive : ''}`}
              id="book-reader-tab"
              type="button"
              role="tab"
              aria-selected={activeCenterTab === 'reader'}
              aria-controls="book-reader-panel"
              onClick={() => setActiveCenterTab('reader')}
            >
              <BookOpen size={16} />
              原文
            </button>
            <button
              className={`${styles.centerTabButton} ${activeCenterTab === 'ai' ? styles.centerTabButtonActive : ''}`}
              id="book-ai-tab"
              type="button"
              role="tab"
              aria-selected={activeCenterTab === 'ai'}
              aria-controls="book-ai-panel"
              onClick={() => setActiveCenterTab('ai')}
            >
              <MessageSquare size={16} />
              AI 对话
            </button>
          </div>

          <div className={styles.centerBody}>
            <section
              className={`${styles.readerPanel} ${activeCenterTab !== 'reader' ? styles.centerPanelHidden : ''}`}
              id="book-reader-panel"
              role="tabpanel"
              aria-labelledby="book-reader-tab"
              aria-hidden={activeCenterTab !== 'reader'}
              ref={centerColumnRef}
            >
              {isBookTextLoading && <div className={styles.bookTextState}>原文加载中</div>}
              {!isBookTextLoading && bookTextError && <div className={styles.bookTextState}>{bookTextError}</div>}
              {!isBookTextLoading && !bookTextError && !bookText?.content && (
                <div className={styles.bookTextState}>请选择一本书</div>
              )}
              {!isBookTextLoading && !bookTextError && bookText?.content && (
                <article className={styles.markdownReader}>
                  <ReactMarkdown>{bookText.content}</ReactMarkdown>
                </article>
              )}
            </section>

            <div
              className={`${styles.aiPanelWrap} ${activeCenterTab !== 'ai' ? styles.centerPanelHidden : ''}`}
              id="book-ai-panel"
              role="tabpanel"
              aria-labelledby="book-ai-tab"
              aria-hidden={activeCenterTab !== 'ai'}
            >
              <BookAi
                bookTitle={selectedBook?.title}
                chapterTitle={selectedChapterTitle}
                bookContent={bookText?.content}
                isBookLoading={isBookTextLoading}
                bookError={bookTextError}
              />
            </div>
          </div>
        </section>
        <aside className={styles.rightColumn} aria-label="Book right column">
          <button
            className={styles.rightResizeHandle}
            type="button"
            aria-label="Resize right column"
            onPointerDown={handleRightResizePointerDown}
          />
          <BookKnowledgeGraph
            graphResponse={selectedGraph}
            selectedChapterId={selectedChapterId}
            selectedChapterTitle={selectedChapterTitle}
            onFocusNode={handleFocusGraphNode}
          />
        </aside>
      </section>
    </main>
  )
}
