import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import AppHeader from '../../components/app-header/app-header'
import { getBookList } from '../../services'
import type { BookListItem } from '../../types'
import styles from './book.module.scss'

type BookWorkspaceStyle = CSSProperties & {
  '--right-column-width': string
}

const rightColumnMinWidth = 260
const rightColumnMaxWidth = 620

function clampRightColumnWidth(width: number) {
  return Math.min(rightColumnMaxWidth, Math.max(rightColumnMinWidth, width))
}

export default function BookPage() {
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false)
  const [rightColumnWidth, setRightColumnWidth] = useState(440)
  const [books, setBooks] = useState<BookListItem[]>([])
  const [expandedBookIds, setExpandedBookIds] = useState<Set<string>>(() => new Set())
  const [isBookListLoading, setIsBookListLoading] = useState(true)
  const [bookListError, setBookListError] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadBookList() {
      setIsBookListLoading(true)
      setBookListError(null)

      try {
        const nextBooks = await getBookList({ signal: controller.signal })
        setBooks(nextBooks)
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setBookListError(error instanceof Error ? error.message : '图书列表加载失败')
      } finally {
        if (!controller.signal.aborted) {
          setIsBookListLoading(false)
        }
      }
    }

    loadBookList()

    return () => {
      controller.abort()
    }
  }, [])

  function handleRightResizePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()

    const startX = event.clientX
    const startWidth = rightColumnWidth
    let latestWidth = startWidth
    const workspace = workspaceRef.current

    workspace?.classList.add(styles.rightResizing)

    function handlePointerMove(moveEvent: PointerEvent) {
      const nextWidth = startWidth + startX - moveEvent.clientX
      latestWidth = clampRightColumnWidth(Math.round(nextWidth))
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

  function toggleBook(bookId: string) {
    setExpandedBookIds((currentBookIds) => {
      const nextBookIds = new Set(currentBookIds)

      if (nextBookIds.has(bookId)) {
        nextBookIds.delete(bookId)
      } else {
        nextBookIds.add(bookId)
      }

      return nextBookIds
    })
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
                    className={styles.bookTitleButton}
                    type="button"
                    aria-expanded={expandedBookIds.has(book.id)}
                    aria-controls={`book-chapters-${book.id}`}
                    onClick={() => toggleBook(book.id)}
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
                        className={styles.chapterButton}
                        type="button"
                        key={chapter.id}
                        tabIndex={expandedBookIds.has(book.id) ? 0 : -1}
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
        <section className={styles.centerColumn} aria-label="Book center column" />
        <aside className={styles.rightColumn} aria-label="Book right column">
          <button
            className={styles.rightResizeHandle}
            type="button"
            aria-label="Resize right column"
            onPointerDown={handleRightResizePointerDown}
          />
        </aside>
      </section>
    </main>
  )
}
