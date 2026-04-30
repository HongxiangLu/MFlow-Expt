import { useEffect, useRef } from 'react'
import { UndirectedGraph } from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import Sigma from 'sigma'

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
  ['simuwu-ding', { label: '司母戊鼎', size: 17, color: '#8c211a' }],
  ['shang', { label: '商代', size: 12, color: '#b88538' }],
  ['bronze', { label: '青铜器', size: 13, color: '#0d6157' }],
  ['taotie', { label: '兽面纹', size: 11, color: '#2d5f83' }],
  ['ritual', { label: '祭祀礼器', size: 11, color: '#736657' }],
  ['yinxu', { label: '殷墟', size: 10, color: '#2d5f83' }],
  ['casting', { label: '范铸法', size: 10, color: '#0d6157' }],
  ['inscription', { label: '铭文', size: 10, color: '#b88538' }],
]

const rootNodeSize = nodes[0][1].size

const edges: Array<[string, string, string, string, number]> = [
  ['simuwu-ding', 'shang', '所属年代', 'e1', 1.2],
  ['simuwu-ding', 'bronze', '器物类别', 'e2', 1.5],
  ['simuwu-ding', 'taotie', '包含纹饰', 'e3', 1],
  ['simuwu-ding', 'ritual', '主要用途', 'e4', 1.1],
  ['simuwu-ding', 'yinxu', '出土地关联', 'e5', 0.9],
  ['bronze', 'casting', '制作工艺', 'e6', 0.8],
  ['bronze', 'inscription', '常见证据', 'e7', 0.7],
  ['shang', 'ritual', '礼制背景', 'e8', 0.9],
  ['taotie', 'ritual', '象征关系', 'e9', 0.7],
]

function buildGraph() {
  const graph = new UndirectedGraph<NodeAttributes, EdgeAttributes>()
  const radius = 8

  nodes.forEach(([key, attributes], index) => {
    const angle = (index / nodes.length) * Math.PI * 2
    graph.addNode(key, {
      ...attributes,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    })
  })

  edges.forEach(([source, target, label, key, weight]) => {
    graph.addEdgeWithKey(key, source, target, {
      label,
      weight,
      size: weight * 2.6,
      color: '#ffffff',
    })
  })

  forceAtlas2.assign(graph, {
    iterations: 160,
    settings: {
      gravity: 1.2,
      scalingRatio: 8,
      slowDown: 8,
      edgeWeightInfluence: 0.8,
    },
  })

  return graph
}

export default function KnowledgeGraph() {
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !minimapRef.current) return

    const graph = buildGraph()
    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: '#ffffff',
      defaultEdgeType: 'line',
      edgeLabelColor: { color: '#736657' },
      edgeLabelSize: 9,
      edgeLabelWeight: '600',
      labelColor: { color: '#1a1714' },
      labelDensity: 0.12,
      labelFont: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      labelRenderedSizeThreshold: 7,
      labelSize: 11,
      labelWeight: '700',
      renderEdgeLabels: true,
      renderLabels: true,
      stagePadding: 24,
    })
    const minimapRenderer = new Sigma(graph, minimapRef.current, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: '#d8cfc1',
      defaultEdgeType: 'line',
      enableCameraPanning: false,
      enableCameraRotation: false,
      enableCameraZooming: false,
      labelDensity: 0,
      renderEdgeLabels: false,
      renderLabels: false,
      stagePadding: 8,
    })

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

    renderer.on('clickNode', ({ node }) => {
      nodes.forEach(([key, attributes]) => {
        graph.setNodeAttribute(key, 'size', key === node ? rootNodeSize : attributes.size)
      })

      const nodeAttributes = graph.getNodeAttributes(node)
      const nodeViewportPosition = renderer.graphToViewport(nodeAttributes)
      const nodeCameraPosition = renderer.viewportToFramedGraph(nodeViewportPosition)
      const camera = renderer.getCamera()
      const cameraState = camera.getState()
      const { width, height } = renderer.getDimensions()
      const centerCameraPosition = renderer.viewportToFramedGraph({
        x: width / 2,
        y: height / 2,
      })

      void camera.animate(
        {
          x: cameraState.x + nodeCameraPosition.x - centerCameraPosition.x,
          y: cameraState.y + nodeCameraPosition.y - centerCameraPosition.y,
        },
        {
          duration: 520,
        },
      )
    })
    renderer.getCamera().on('updated', syncMinimapViewport)
    renderer.on('resize', syncMinimapViewport)
    minimapRenderer.on('resize', syncMinimapViewport)

    requestAnimationFrame(syncMinimapViewport)

    return () => {
      renderer.kill()
      minimapRenderer.kill()
    }
  }, [])

  return (
    <div className={styles.graph}>
      <div className={styles.graphStage} ref={containerRef} aria-label="文物关系图谱模拟数据" />
      <div className={styles.minimap} aria-hidden="true">
        <div className={styles.minimapStage} ref={minimapRef} />
        <div className={styles.minimapViewport} ref={minimapViewportRef} />
      </div>
    </div>
  )
}
