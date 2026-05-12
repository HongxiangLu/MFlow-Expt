import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { BookOpen, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import AppHeader from '../../components/app-header/app-header'
import BookKnowledgeGraph from '../../components/book-knowledge-graph/book-knowledge-graph'
import BookAi from './bookai'
import { getBookGraph, getBookGraphNodeSources } from '../../services'
import { useBookStoreController } from '../../store/book'
import type { BookChapter, BookSourceRef, GraphNode, GraphResponse } from '../../types'
import styles from './book.module.scss'

type BookWorkspaceStyle = CSSProperties & {
  '--right-column-width': string
}

type CenterTab = 'reader' | 'ai'

const rightColumnMinWidth = 260
const markdownHeadingSelector = 'h1, h2, h3, h4, h5, h6'
const sourceHighlightAttribute = 'data-book-source-highlight'

function clampRightColumnWidth(width: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(rightColumnMinWidth, width))
}

function flattenChapters(chapters: BookChapter[], level = 0): Array<BookChapter & { depth: number }> {
  return chapters.flatMap((chapter) => [
    { ...chapter, depth: level },
    ...flattenChapters(chapter.children ?? [], level + 1),
  ])
}

function isCanceledError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (typeof error === 'object' && error) {
    const maybeCanceledError = error as { code?: unknown; name?: unknown }

    return maybeCanceledError.code === 'ERR_CANCELED' || maybeCanceledError.name === 'CanceledError'
  }

  return false
}

function removeSourceHighlights(container: HTMLElement) {
  container.querySelectorAll(`mark[${sourceHighlightAttribute}]`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return

    mark.replaceWith(...Array.from(mark.childNodes))
    parent.normalize()
  })
}

function getTextNodes(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let currentNode = walker.nextNode()

  while (currentNode) {
    textNodes.push(currentNode as Text)
    currentNode = walker.nextNode()
  }

  return textNodes
}

function getRangeFromTextOffsets(textNodes: Text[], startOffset: number, endOffset: number) {
  const range = document.createRange()
  let currentOffset = 0
  let didSetStart = false

  for (const textNode of textNodes) {
    const nextOffset = currentOffset + textNode.data.length

    if (!didSetStart && startOffset >= currentOffset && startOffset <= nextOffset) {
      range.setStart(textNode, startOffset - currentOffset)
      didSetStart = true
    }

    if (didSetStart && endOffset >= currentOffset && endOffset <= nextOffset) {
      range.setEnd(textNode, endOffset - currentOffset)
      return range
    }

    currentOffset = nextOffset
  }

  return null
}

function findQuoteRange(container: HTMLElement, quote: string) {
  const normalizedQuote = quote.replace(/\s+/g, ' ').trim()
  if (!normalizedQuote) return null

  const textNodes = getTextNodes(container)
  const fullText = textNodes.map((textNode) => textNode.data).join('')
  const directIndex = fullText.indexOf(quote.trim())

  if (directIndex >= 0) {
    return getRangeFromTextOffsets(textNodes, directIndex, directIndex + quote.trim().length)
  }

  const shortQuote = normalizedQuote.slice(0, 80)
  const normalizedFullText = fullText.replace(/\s+/g, ' ')
  const normalizedIndex = normalizedFullText.indexOf(shortQuote)

  if (normalizedIndex < 0) return null

  const originalPrefix = normalizedFullText.slice(0, normalizedIndex)
  let originalStart = 0
  let normalizedCursor = 0

  while (originalStart < fullText.length && normalizedCursor < originalPrefix.length) {
    const currentChar = fullText[originalStart]
    const normalizedChar = /\s/.test(currentChar) ? ' ' : currentChar
    const previousNormalizedChar = normalizedCursor > 0 ? originalPrefix[normalizedCursor - 1] : ''

    if (normalizedChar !== ' ' || previousNormalizedChar !== ' ') {
      normalizedCursor += 1
    }

    originalStart += 1
  }

  return getRangeFromTextOffsets(textNodes, originalStart, Math.min(fullText.length, originalStart + shortQuote.length))
}

function highlightSourceRef(container: HTMLElement, ref: BookSourceRef, markdown?: string) {
  removeSourceHighlights(container)

  const quote = ref.quote || markdown?.slice(ref.startOffset, ref.endOffset) || ''
  const range = findQuoteRange(container, quote)

  if (!range) return false

  const mark = document.createElement('mark')
  mark.setAttribute(sourceHighlightAttribute, 'true')
  mark.append(range.extractContents())
  range.insertNode(mark)
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' })

  return true
}

export default function BookPage() {
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [rightColumnWidth, setRightColumnWidth] = useState(440)
  const [activeCenterTab, setActiveCenterTab] = useState<CenterTab>('reader')
  const [bookGraph, setBookGraph] = useState<GraphResponse | null>(null)
  const [sourceHighlightRef, setSourceHighlightRef] = useState<BookSourceRef | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const nodeSourcesAbortControllerRef = useRef<AbortController | undefined>(undefined)
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
  const handleSelectChapterRef = useRef(handleSelectChapter)
  const selectedBook = books.find((book) => book.id === selectedBookId)
  const selectedBookChapters = useMemo(() => flattenChapters(selectedBook?.chapters ?? []), [selectedBook])
  const selectedChapterTitle = selectedBookChapters.find((chapter) => chapter.id === selectedChapterId)?.title

  useEffect(() => {
    handleSelectChapterRef.current = handleSelectChapter
  }, [handleSelectChapter])

  useEffect(() => {
    return () => {
      nodeSourcesAbortControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!selectedBookId) {
      setBookGraph(null)
      return
    }

    const controller = new AbortController()

    setBookGraph(null)
    setSourceHighlightRef(null)

    void getBookGraph(selectedBookId, { signal: controller.signal })
      .then(setBookGraph)
      .catch((error: unknown) => {
        const maybeCanceledError = error as { code?: unknown; name?: unknown }
        const isCanceled = maybeCanceledError.code === 'ERR_CANCELED' || maybeCanceledError.name === 'CanceledError'

        if (!isCanceled) {
          setBookGraph(null)
        }
      })

    return () => {
      controller.abort()
    }
  }, [selectedBookId])

  useEffect(() => {
    if (!sourceHighlightRef || !bookText?.content || activeCenterTab !== 'reader') return

    const frameId = window.requestAnimationFrame(() => {
      const centerColumn = centerColumnRef.current
      if (!centerColumn) return

      const didHighlight = highlightSourceRef(centerColumn, sourceHighlightRef, bookText.content)

      if (didHighlight || !sourceHighlightRef.chapterTitle) return

      const headings = Array.from(centerColumn.querySelectorAll(markdownHeadingSelector))
      const fallbackHeading = headings.find((heading) => heading.textContent?.trim() === sourceHighlightRef.chapterTitle)
      fallbackHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeCenterTab, bookText?.content, centerColumnRef, sourceHighlightRef])

  const handleFocusGraphNode = useCallback(
    async (node: GraphNode) => {
      setActiveCenterTab('reader')
      nodeSourcesAbortControllerRef.current?.abort()

      if (!selectedBookId) {
        return
      }

      nodeSourcesAbortControllerRef.current = new AbortController()

      try {
        const refs =
          node.sourceRefs && node.sourceRefs.length > 0
            ? node.sourceRefs
            : await getBookGraphNodeSources(node.id, selectedBookId, {
                signal: nodeSourcesAbortControllerRef.current.signal,
              })
        const sourceRef = refs[0]

        if (sourceRef) {
          const targetChapter = selectedBookChapters.find((chapter) => chapter.id === sourceRef.chapterId)

          if (selectedBook && targetChapter) {
            handleSelectChapterRef.current(selectedBook, targetChapter)
          }

          setSourceHighlightRef(sourceRef)
          return
        }
      } catch (error) {
        if (isCanceledError(error)) {
          return
        }
      }

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
    [centerColumnRef, selectedBook, selectedBookChapters, selectedBookId],
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

  function clearSourceHighlight() {
    setSourceHighlightRef(null)

    const centerColumn = centerColumnRef.current
    if (centerColumn) {
      removeSourceHighlights(centerColumn)
    }
  }

  function handleBookClick(bookId: string) {
    clearSourceHighlight()
    handleSelectBook(bookId)
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
                    onClick={() => handleBookClick(book.id)}
                  >
                    <span>{book.title}</span>
                    {expandedBookIds.has(book.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  <div
                    className={`${styles.chapterList} ${expandedBookIds.has(book.id) ? styles.chapterListOpen : ''}`}
                    id={`book-chapters-${book.id}`}
                  >
                    {flattenChapters(book.chapters).map((chapter) => (
                      <button
                        className={`${styles.chapterButton} ${selectedChapterId === chapter.id ? styles.chapterButtonActive : ''}`}
                        type="button"
                        key={chapter.id}
                        style={{ paddingLeft: `${12 + chapter.depth * 14}px` }}
                        tabIndex={expandedBookIds.has(book.id) ? 0 : -1}
                        onClick={() => {
                          clearSourceHighlight()
                          handleSelectChapter(book, chapter)
                        }}
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
                knowledgeBaseId={selectedBook?.knowledgeBaseId}
                bookId={selectedBook?.id}
                chapterId={selectedChapterId ?? undefined}
                bookTitle={selectedBook?.title}
                chapterTitle={selectedChapterTitle}
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
            graphResponse={bookGraph}
            selectedChapterId={selectedChapterId}
            selectedChapterTitle={selectedChapterTitle}
            onFocusNode={handleFocusGraphNode}
          />
        </aside>
      </section>
    </main>
  )
}
