import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import AppHeader from '../../components/app-header/app-header'
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
  const workspaceRef = useRef<HTMLElement>(null)

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
