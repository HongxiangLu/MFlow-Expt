import { useEffect, useRef } from 'react'
import { UndirectedGraph } from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import Sigma from 'sigma'
import { Maximize2 } from 'lucide-react'

import styles from './knowledge-graph.module.scss'

type NodeAttributes = {
  x: number
  y: number
  label: string
  size: number
  color: string
}

type EdgeAttributes = {
  label: string
  size: number
  color: string
  weight: number
}

const nodes: Array<[string, Omit<NodeAttributes, 'x' | 'y'>]> = [
  ['jiaboyi', { label: '杜工部草堂诗笺', size: 18, color: '#d4af37' }],
  ['western-zhou', { label: '西周早期', size: 13, color: '#b8873a' }],
  ['bronze', { label: '青铜', size: 13, color: '#0f766e' }],
  ['ritual-vessel', { label: '青铜礼器', size: 12, color: '#7f4f24' }],
  ['beast-mask', { label: '兽面纹', size: 11, color: '#2d5f83' }],
  ['thunder-pattern', { label: '云雷纹', size: 10, color: '#355f4a' }],
  ['inscription', { label: '铭文', size: 11, color: '#9a6b2f' }],
  ['changsha', { label: '湖南长沙', size: 10, color: '#256d85' }],
  ['casting', { label: '铸造工艺', size: 10, color: '#0d6157' }],
  ['ritual-system', { label: '礼制祭祀', size: 11, color: '#6a5a3c' }],
  ['size', { label: '通高28.5cm', size: 9, color: '#71717b' }],
]

const edges: Array<[string, string, string, string, number]> = [
  ['jiaboyi', 'western-zhou', '所属年代', 'e1', 1.2],
  ['jiaboyi', 'bronze', '主要材质', 'e2', 1.5],
  ['jiaboyi', 'ritual-vessel', '器物类型', 'e3', 1.3],
  ['jiaboyi', 'beast-mask', '包含纹饰', 'e4', 1.1],
  ['jiaboyi', 'inscription', '铭文证据', 'e5', 1],
  ['jiaboyi', 'changsha', '出土地点', 'e6', 0.9],
  ['jiaboyi', 'size', '尺寸', 'e7', 0.7],
  ['bronze', 'casting', '制作工艺', 'e8', 1],
  ['bronze', 'ritual-vessel', '礼器材质', 'e9', 0.9],
  ['ritual-vessel', 'ritual-system', '使用场景', 'e10', 1.1],
  ['beast-mask', 'ritual-system', '象征关系', 'e11', 0.9],
  ['beast-mask', 'thunder-pattern', '纹饰组合', 'e12', 0.8],
  ['inscription', 'western-zhou', '断代依据', 'e13', 0.7],
  ['casting', 'western-zhou', '时代工艺', 'e14', 0.7],
]

const focusedCameraRatio = 0.55

function buildGraph() {
  const graph = new UndirectedGraph<NodeAttributes, EdgeAttributes>()
  const seedPositions: Record<string, { x: number; y: number }> = {
    jiaboyi: { x: 0, y: 0 },
    'western-zhou': { x: -3.2, y: -5.6 },
    bronze: { x: 4.7, y: -3.5 },
    'ritual-vessel': { x: 6.5, y: 1.2 },
    'beast-mask': { x: 2.8, y: 5.4 },
    'thunder-pattern': { x: 6.9, y: 6.2 },
    inscription: { x: -2.2, y: 5.9 },
    changsha: { x: -6.4, y: 2.4 },
    casting: { x: 7.8, y: -6.1 },
    'ritual-system': { x: -5.9, y: -2.8 },
    size: { x: -8.1, y: 6.5 },
  }

  nodes.forEach(([key, attributes], index) => {
    const seed = seedPositions[key]
    graph.addNode(key, {
      ...attributes,
      x: seed?.x ?? Math.cos(index) * 7,
      y: seed?.y ?? Math.sin(index) * 7,
    })
  })

  edges.forEach(([source, target, label, key, weight]) => {
    graph.addEdgeWithKey(key, source, target, {
      label,
      weight,
      size: weight * 1.5,
      color: 'rgba(106, 90, 60, 0.78)',
    })
  })

  forceAtlas2.assign(graph, {
    iterations: 160,
    settings: {
      gravity: 1.2,
      scalingRatio: 5.5,
      slowDown: 6,
      edgeWeightInfluence: 0.85,
    },
  })

  return graph
}

export default function KnowledgeGraph() {
  const graphRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapContainerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !minimapContainerRef.current || !minimapRef.current) return

    const graph = buildGraph()
    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: 'rgba(106, 90, 60, 0.76)',
      defaultEdgeType: 'line',
      edgeLabelColor: { color: '#8d7a55' },
      edgeLabelSize: 8,
      edgeLabelWeight: '500',
      labelColor: { color: '#d4d4d8' },
      labelDensity: 0.25,
      labelFont: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      labelRenderedSizeThreshold: 6,
      labelSize: 11,
      labelWeight: '500',
      renderEdgeLabels: false,
      renderLabels: true,
      stagePadding: 38,
    })
    const minimapRenderer = new Sigma(graph, minimapRef.current, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: 'rgba(106, 90, 60, 0.72)',
      defaultEdgeType: 'line',
      edgeReducer: (_, attributes) => ({
        ...attributes,
        color: 'rgba(106, 90, 60, 0.65)',
        size: 0.8,
      }),
      enableCameraPanning: false,
      enableCameraRotation: false,
      enableCameraZooming: false,
      labelDensity: 0,
      renderEdgeLabels: false,
      renderLabels: false,
      stagePadding: 16,
    })
    const minimapContainer = minimapContainerRef.current
    let isDraggingMinimap = false
    let minimapDragOffset = { x: 0, y: 0 }
    let fullscreenResizeTimeout: number | undefined

    function getGraphContainerBounds() {
      const graphContainer = graphRef.current
      if (!graphContainer) return null

      const graphRect = graphContainer.getBoundingClientRect()
      const minimapRect = minimapContainer.getBoundingClientRect()

      return {
        graphRect,
        minimapRect,
        maxLeft: Math.max(0, graphRect.width - minimapRect.width),
        maxTop: Math.max(0, graphRect.height - minimapRect.height),
      }
    }

    function clampMinimapPosition() {
      const bounds = getGraphContainerBounds()
      if (!bounds || (!minimapContainer.style.left && !minimapContainer.style.top)) return

      const currentLeft = bounds.minimapRect.left - bounds.graphRect.left
      const currentTop = bounds.minimapRect.top - bounds.graphRect.top
      const nextLeft = Math.max(0, Math.min(currentLeft, bounds.maxLeft))
      const nextTop = Math.max(0, Math.min(currentTop, bounds.maxTop))

      minimapContainer.style.left = `${nextLeft}px`
      minimapContainer.style.top = `${nextTop}px`
      minimapContainer.style.right = 'auto'
      minimapContainer.style.bottom = 'auto'
    }

    function syncMinimapViewport() {
      const viewport = minimapViewportRef.current
      if (!viewport) return

      const { width, height } = renderer.getDimensions()
      if (width <= 1 || height <= 1) return

      const points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ]
        .map((point) => renderer.viewportToFramedGraph(point))
        .map((point) => minimapRenderer.framedGraphToViewport(point))

      const xValues = points.map((point) => point.x)
      const yValues = points.map((point) => point.y)
      const left = Math.min(...xValues)
      const top = Math.min(...yValues)
      const right = Math.max(...xValues)
      const bottom = Math.max(...yValues)

      viewport.style.transform = `translate(${left}px, ${top}px)`
      viewport.style.width = `${right - left}px`
      viewport.style.height = `${bottom - top}px`
    }

    function moveMinimap(event: PointerEvent) {
      const bounds = getGraphContainerBounds()
      if (!bounds) return

      const nextLeft = Math.max(
        0,
        Math.min(event.clientX - bounds.graphRect.left - minimapDragOffset.x, bounds.maxLeft),
      )
      const nextTop = Math.max(
        0,
        Math.min(event.clientY - bounds.graphRect.top - minimapDragOffset.y, bounds.maxTop),
      )

      minimapContainer.style.left = `${nextLeft}px`
      minimapContainer.style.top = `${nextTop}px`
      minimapContainer.style.right = 'auto'
      minimapContainer.style.bottom = 'auto'
    }

    function handleMinimapPointerDown(event: PointerEvent) {
      event.preventDefault()
      const rect = minimapContainer.getBoundingClientRect()
      isDraggingMinimap = true
      minimapDragOffset = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      minimapContainer.style.cursor = 'grabbing'
      moveMinimap(event)
    }

    function handleMinimapPointerMove(event: PointerEvent) {
      if (!isDraggingMinimap) return
      event.preventDefault()
      moveMinimap(event)
    }

    function handleMinimapPointerUp() {
      isDraggingMinimap = false
      minimapContainer.style.cursor = ''
    }

    function handleFullscreenChange() {
      window.clearTimeout(fullscreenResizeTimeout)
      fullscreenResizeTimeout = window.setTimeout(() => {
        clampMinimapPosition()
        renderer.resize()
        minimapRenderer.resize()
        syncMinimapViewport()
      }, 80)
    }

    renderer.on('clickNode', ({ node }) => {
      const nodeAttributes = graph.getNodeAttributes(node)
      const nodeViewportPosition = renderer.graphToViewport(nodeAttributes)
      const nodeCameraPosition = renderer.viewportToFramedGraph(nodeViewportPosition)
      const camera = renderer.getCamera()
      const cameraState = camera.getState()

      void camera.animate(
        {
          x: nodeCameraPosition.x,
          y: nodeCameraPosition.y,
          ratio: Math.min(cameraState.ratio, focusedCameraRatio),
        },
        {
          duration: 520,
        },
      )
    })
    renderer.getCamera().on('updated', syncMinimapViewport)
    renderer.on('resize', syncMinimapViewport)
    minimapRenderer.on('resize', syncMinimapViewport)
    minimapContainer.addEventListener('pointerdown', handleMinimapPointerDown)
    window.addEventListener('pointermove', handleMinimapPointerMove)
    window.addEventListener('pointerup', handleMinimapPointerUp)
    window.addEventListener('pointercancel', handleMinimapPointerUp)
    document.addEventListener('fullscreenchange', handleFullscreenChange)

    requestAnimationFrame(syncMinimapViewport)

    return () => {
      window.clearTimeout(fullscreenResizeTimeout)
      minimapContainer.removeEventListener('pointerdown', handleMinimapPointerDown)
      window.removeEventListener('pointermove', handleMinimapPointerMove)
      window.removeEventListener('pointerup', handleMinimapPointerUp)
      window.removeEventListener('pointercancel', handleMinimapPointerUp)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      renderer.kill()
      minimapRenderer.kill()
    }
  }, [])

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await graphRef.current?.requestFullscreen()
  }

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
