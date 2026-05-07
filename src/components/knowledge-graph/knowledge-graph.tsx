import { Maximize2 } from 'lucide-react'

import { useKnowledgeGraphStoreController } from '../../store/graph-store.test'
import styles from './knowledge-graph.module.scss'

export default function KnowledgeGraph() {
  const { graphRef, containerRef, minimapContainerRef, minimapRef, minimapViewportRef, toggleFullscreen } =
    useKnowledgeGraphStoreController()

  return (
    <div className={styles.graph} ref={graphRef}>
      <div className={styles.graphStage} ref={containerRef} aria-label="杜工部草堂诗笺知识图谱 Sigma 画布" />
      <button
        className={styles.fullscreenButton}
        type="button"
        aria-label="切换关系图谱全屏"
        onClick={toggleFullscreen}
      >
        <Maximize2 size={16} />
      </button>
      <div className={styles.minimap} ref={minimapContainerRef} aria-label="拖拽移动小地图位置">
        <div className={styles.minimapStage} ref={minimapRef} />
        <div className={styles.minimapViewport} ref={minimapViewportRef} />
      </div>
    </div>
  )
}
