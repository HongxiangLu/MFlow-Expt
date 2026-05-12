import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { UndirectedGraph } from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import Sigma from 'sigma'

import GraphFullscreenButton from '../graph-fullscreen-button/graph-fullscreen-button'
import type { GraphNode, GraphNodeType, GraphResponse } from '../../types'
import styles from './book-knowledge-graph.module.scss'

type NodeAttributes = {
  x: number
  y: number
  label: string
  labelColor: string
  nodeType: GraphNodeType
  size: number
  color: string
  baseColor: string
  isCenterNode: boolean
}

type EdgeAttributes = {
  label: string
  labelColor: string
  size: number
  color: string
  weight: number
}

type BookKnowledgeGraphProps = {
  graphResponse: GraphResponse | null
  selectedChapterId: string | null
  selectedChapterTitle?: string
  onFocusNode?: (node: GraphNode) => void
}

const focusedCameraRatio = 0.64
const minCameraRatio = 0.05
const maxCameraRatio = 8

const nodeTypeColorMap: Record<string, string> = {
  knowledge_base: '#b45309',
  book: '#1d4ed8',
  chapter: '#0891b2',
  section: '#0f766e',
  person: '#8b5cf6',
  site: '#256d85',
  concept: '#a16207',
  collection: '#7c3aed',
  artifact: '#d4af37',
  dynasty: '#b8873a',
  material: '#0f766e',
  category: '#7f4f24',
  pattern: '#2d5f83',
  craft: '#0d6157',
  inscription: '#9a6b2f',
  usage: '#6a5a3c',
  other: '#71717b',
}

const nodeTypeLabelMap: Record<string, string> = {
  knowledge_base: '知识库',
  book: '书籍',
  chapter: '章节',
  section: '部分',
  person: '人物',
  site: '地点',
  concept: '概念',
  collection: '组织',
  other: '其他',
}

function getNodeColor(nodeType: GraphNodeType) {
  return nodeTypeColorMap[nodeType] ?? nodeTypeColorMap.other
}

function getNodeTypeLabel(nodeType: GraphNodeType) {
  return nodeTypeLabelMap[nodeType] ?? nodeType
}

function getNodeSize(nodeType: GraphNodeType, isCenterNode: boolean, degree: number) {
  if (isCenterNode || nodeType === 'book') return 15
  if (nodeType === 'section') return 10
  if (nodeType === 'chapter') return 9

  return Math.min(9, 5 + degree * 0.45)
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase()
}

function buildGraph(graphResponse: GraphResponse) {
  const graph = new UndirectedGraph<NodeAttributes, EdgeAttributes>()
  const degrees = graphResponse.edges.reduce<Record<string, number>>((accumulator, edge) => {
    accumulator[edge.source] = (accumulator[edge.source] ?? 0) + 1
    accumulator[edge.target] = (accumulator[edge.target] ?? 0) + 1

    return accumulator
  }, {})

  graphResponse.nodes.forEach((node, index) => {
    const isCenterNode = node.id === graphResponse.centerNodeId
    const baseColor = getNodeColor(node.nodeType)
    const radius = 8 + index * 0.28

    graph.addNode(node.id, {
      label: node.label,
      labelColor: '#111827',
      nodeType: node.nodeType,
      size: getNodeSize(node.nodeType, isCenterNode, degrees[node.id] ?? 0),
      color: baseColor,
      baseColor,
      isCenterNode,
      x: isCenterNode ? 0 : Math.cos(index * 2.399963) * radius,
      y: isCenterNode ? 0 : Math.sin(index * 2.399963) * radius,
    })
  })

  graphResponse.edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target) || graph.hasEdge(edge.id)) return

    const weight = edge.weight ?? 1

    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label,
      labelColor: '#64748b',
      weight,
      size: Math.max(0.8, weight * 1.5),
      color: 'rgba(100, 116, 139, 0.66)',
    })
  })

  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: 180,
      settings: {
        gravity: 1.15,
        scalingRatio: 5.2,
        slowDown: 9,
        edgeWeightInfluence: 0.8,
      },
    })
  }

  return graph
}

function getChapterFocusNodeId(
  graphResponse: GraphResponse | null,
  selectedChapterId: string | null,
  selectedChapterTitle?: string,
) {
  if (!graphResponse || !selectedChapterId) return null

  const exactCandidates = [`chapter-${selectedChapterId}`, `section-${selectedChapterId}`, selectedChapterId]
  const exactMatch = exactCandidates.find((id) => graphResponse.nodes.some((node) => node.id === id))

  if (exactMatch) return exactMatch

  if (selectedChapterId.startsWith('qiwang-shuwang')) return 'section-shuwang'
  if (selectedChapterId.startsWith('qiwang-qiwang')) return 'section-qiwang'
  if (selectedChapterId.startsWith('qiwang-haiziwang')) return 'section-haiziwang'

  const title = selectedChapterTitle?.trim()
  if (!title) return null

  const titleMatch = graphResponse.nodes.find(
    (node) =>
      node.label === title ||
      title.includes(node.label) ||
      node.label.includes(title) ||
      title.split(/\s+/).some((part) => part.length >= 2 && node.label === part),
  )

  return titleMatch?.id ?? null
}

function isEdgeConnectedToNode(graph: UndirectedGraph<NodeAttributes, EdgeAttributes>, edgeId: string, nodeId: string) {
  return graph.source(edgeId) === nodeId || graph.target(edgeId) === nodeId
}

export default function BookKnowledgeGraph({
  graphResponse,
  selectedChapterId,
  selectedChapterTitle,
  onFocusNode,
}: BookKnowledgeGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeNodeType, setActiveNodeType] = useState<string | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Sigma<NodeAttributes, EdgeAttributes> | null>(null)
  const graphRef = useRef<UndirectedGraph<NodeAttributes, EdgeAttributes> | null>(null)
  const hoveredNodeIdRef = useRef<string | null>(null)
  const selectedNodeIdRef = useRef<string | null>(null)
  const activeNodeTypeRef = useRef<string | null>(null)
  const searchValueRef = useRef('')
  const chapterFocusNodeIdRef = useRef<string | null>(null)
  const graphResponseRef = useRef<GraphResponse | null>(graphResponse)
  const chapterFocusNodeId = getChapterFocusNodeId(graphResponse, selectedChapterId, selectedChapterTitle)
  const activeNodeId = hoveredNodeId ?? chapterFocusNodeId ?? selectedNodeId ?? graphResponse?.centerNodeId ?? null
  const activeNode = graphResponse?.nodes.find((node) => node.id === activeNodeId) ?? null
  const nodeTypes = useMemo(() => {
    if (!graphResponse) return []

    return Array.from(new Set(graphResponse.nodes.map((node) => node.nodeType))).sort((a, b) =>
      getNodeTypeLabel(a).localeCompare(getNodeTypeLabel(b), 'zh-CN'),
    )
  }, [graphResponse])
  const normalizedSearchValue = normalizeSearchValue(searchValue)
  const searchResults = useMemo(() => {
    if (!graphResponse || !normalizedSearchValue) return []

    return graphResponse.nodes
      .filter((node) => node.label.toLowerCase().includes(normalizedSearchValue))
      .slice(0, 8)
  }, [graphResponse, normalizedSearchValue])

  useEffect(() => {
    hoveredNodeIdRef.current = hoveredNodeId
    rendererRef.current?.refresh()
  }, [hoveredNodeId])

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId
    rendererRef.current?.refresh()
  }, [selectedNodeId])

  useEffect(() => {
    activeNodeTypeRef.current = activeNodeType
    rendererRef.current?.refresh()
  }, [activeNodeType])

  useEffect(() => {
    searchValueRef.current = normalizedSearchValue
    rendererRef.current?.refresh()
  }, [normalizedSearchValue])

  useEffect(() => {
    chapterFocusNodeIdRef.current = chapterFocusNodeId
    rendererRef.current?.refresh()
  }, [chapterFocusNodeId])

  useEffect(() => {
    graphResponseRef.current = graphResponse
  }, [graphResponse])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !graphResponse) return

    const graph = buildGraph(graphResponse)
    graphRef.current = graph
    let fullscreenResizeTimeout: number | undefined

    const renderer = new Sigma<NodeAttributes, EdgeAttributes>(graph, stage, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: 'rgba(100, 116, 139, 0.62)',
      defaultEdgeType: 'line',
      edgeLabelColor: { color: '#64748b' },
      edgeLabelSize: 10,
      edgeLabelWeight: '600',
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      labelColor: { attribute: 'labelColor', color: '#111827' },
      labelDensity: 0.28,
      labelFont: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      labelRenderedSizeThreshold: 7,
      labelSize: 12,
      labelWeight: '700',
      maxCameraRatio,
      minCameraRatio,
      renderEdgeLabels: true,
      renderLabels: true,
      stagePadding: 32,
      nodeReducer: (nodeId, attributes) => {
        const hovered = hoveredNodeIdRef.current
        const selected = selectedNodeIdRef.current
        const type = activeNodeTypeRef.current
        const query = searchValueRef.current
        const focusedChapterNodeId = chapterFocusNodeIdRef.current
        const currentGraph = graphRef.current
        const isContextActive = Boolean(hovered || selected)
        const contextNodeId = hovered ?? selected
        const matchesType = !type || attributes.nodeType === type || attributes.isCenterNode
        const matchesSearch = !query || attributes.label.toLowerCase().includes(query)
        const isRelated =
          !contextNodeId || nodeId === contextNodeId || Boolean(currentGraph?.hasEdge(nodeId, contextNodeId))
        const isChapterFocus = focusedChapterNodeId === nodeId

        if (!matchesType || !matchesSearch) {
          return {
            ...attributes,
            color: 'rgba(148, 163, 184, 0.38)',
            labelColor: '#94a3b8',
            size: Math.max(3, attributes.size * 0.68),
          }
        }

        if (isContextActive && !isRelated) {
          return {
            ...attributes,
            color: 'rgba(148, 163, 184, 0.46)',
            labelColor: '#94a3b8',
            size: Math.max(3, attributes.size * 0.76),
          }
        }

        if (nodeId === selected || isChapterFocus) {
          return {
            ...attributes,
            color: '#dc2626',
            labelColor: '#991b1b',
            size: attributes.size + 4,
            zIndex: 10,
            forceLabel: true,
          }
        }

        if (nodeId === hovered) {
          return {
            ...attributes,
            color: '#ea580c',
            labelColor: '#9a3412',
            size: attributes.size + 3,
            zIndex: 11,
            forceLabel: true,
          }
        }

        return {
          ...attributes,
          color: attributes.baseColor,
          labelColor: '#111827',
          size: attributes.size,
        }
      },
      edgeReducer: (edgeId, attributes) => {
        const hovered = hoveredNodeIdRef.current
        const selected = selectedNodeIdRef.current
        const type = activeNodeTypeRef.current
        const query = searchValueRef.current
        const currentGraph = graphRef.current
        const contextNodeId = hovered ?? selected

        if (!currentGraph) return attributes

        const sourceId = currentGraph.source(edgeId)
        const targetId = currentGraph.target(edgeId)
        const source = currentGraph.getNodeAttributes(sourceId)
        const target = currentGraph.getNodeAttributes(targetId)
        const matchesType = !type || source.nodeType === type || target.nodeType === type || source.isCenterNode
        const matchesSearch =
          !query || source.label.toLowerCase().includes(query) || target.label.toLowerCase().includes(query)

        if (!matchesType || !matchesSearch) {
          return {
            ...attributes,
            color: 'rgba(148, 163, 184, 0.28)',
            labelColor: '#94a3b8',
            size: 0.35,
          }
        }

        if (contextNodeId && !isEdgeConnectedToNode(currentGraph, edgeId, contextNodeId)) {
          return {
            ...attributes,
            color: 'rgba(148, 163, 184, 0.34)',
            labelColor: '#94a3b8',
            size: 0.5,
          }
        }

        return {
          ...attributes,
          color: contextNodeId ? 'rgba(220, 38, 38, 0.62)' : attributes.color,
          labelColor: contextNodeId ? '#991b1b' : attributes.labelColor,
          size: contextNodeId ? attributes.size + 0.8 : attributes.size,
          forceLabel: Boolean(contextNodeId),
        }
      },
    })

    rendererRef.current = renderer

    renderer.on('enterNode', ({ node }) => setHoveredNodeId(node))
    renderer.on('leaveNode', () => setHoveredNodeId(null))
    renderer.on('clickNode', ({ node }) => {
      setSelectedNodeId(node)
      focusNode(node)

      const focusedNode = graphResponseRef.current?.nodes.find((item) => item.id === node)
      if (focusedNode) onFocusNode?.(focusedNode)
    })
    renderer.on('clickStage', () => setSelectedNodeId(null))

    function handleFullscreenChange() {
      window.clearTimeout(fullscreenResizeTimeout)
      fullscreenResizeTimeout = window.setTimeout(() => {
        renderer.resize()
        renderer.refresh()
      }, 80)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    requestAnimationFrame(() => {
      focusNode(chapterFocusNodeId ?? graphResponse.centerNodeId, false)
    })

    return () => {
      window.clearTimeout(fullscreenResizeTimeout)
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      renderer.kill()
      rendererRef.current = null
      graphRef.current = null
    }
    // chapterFocusNodeId is handled in a separate effect to avoid rebuilding the graph while navigating chapters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphResponse, onFocusNode])

  useEffect(() => {
    if (!chapterFocusNodeId) return

    focusNode(chapterFocusNodeId)
  }, [chapterFocusNodeId])

  function focusNode(nodeId: string | null, animated = true) {
    const renderer = rendererRef.current
    const graph = graphRef.current
    if (!nodeId || !renderer || !graph?.hasNode(nodeId)) return

    const nodeAttributes = graph.getNodeAttributes(nodeId)
    const nodeViewportPosition = renderer.graphToViewport(nodeAttributes)
    const nodeCameraPosition = renderer.viewportToFramedGraph(nodeViewportPosition)
    const camera = renderer.getCamera()
    const nextState = {
      x: nodeCameraPosition.x,
      y: nodeCameraPosition.y,
      ratio: Math.min(camera.getState().ratio, focusedCameraRatio),
    }

    if (animated) {
      void camera.animate(nextState, { duration: 520 })
      return
    }

    camera.setState(nextState)
  }

  function resetView() {
    setHoveredNodeId(null)
    setSelectedNodeId(null)
    setActiveNodeType(null)
    setSearchValue('')
    focusNode(graphResponse?.centerNodeId ?? null)
  }

  function handleSearchResultClick(node: GraphNode) {
    setSelectedNodeId(node.id)
    focusNode(node.id)
    onFocusNode?.(node)
  }

  if (!graphResponse) {
    return (
      <div className={styles.graphPanel}>
        <div className={styles.emptyState}>请选择一本书查看知识图谱</div>
      </div>
    )
  }

  return (
    <div className={styles.graphPanel} ref={panelRef}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2>{graphResponse.nodes.find((node) => node.id === graphResponse.centerNodeId)?.label ?? '知识图谱'}</h2>
          <span className={styles.stats}>
            {graphResponse.nodes.length} 点 / {graphResponse.edges.length} 线
          </span>
        </div>

        <div className={styles.controls}>
          <input
            className={styles.searchBox}
            type="search"
            value={searchValue}
            aria-label="搜索图谱节点"
            placeholder="搜索节点"
            onChange={(event) => setSearchValue(event.target.value)}
          />
          <button className={styles.iconButton} type="button" aria-label="重置图谱视图" onClick={resetView}>
            <RotateCcw size={16} />
          </button>
          <GraphFullscreenButton className={styles.iconButton} targetRef={panelRef} aria-label="切换图谱全屏" />
        </div>

        <div className={styles.typeFilters} aria-label="节点类型过滤">
          <button
            className={`${styles.typeButton} ${activeNodeType === null ? styles.typeButtonActive : ''}`}
            type="button"
            onClick={() => setActiveNodeType(null)}
          >
            全部
          </button>
          {nodeTypes.map((nodeType) => (
            <button
              className={`${styles.typeButton} ${activeNodeType === nodeType ? styles.typeButtonActive : ''}`}
              type="button"
              key={nodeType}
              onClick={() => setActiveNodeType(nodeType)}
            >
              {getNodeTypeLabel(nodeType)}
            </button>
          ))}
        </div>
      </div>

      {searchResults.length > 0 && (
        <div className={styles.searchResults}>
          {searchResults.map((node) => (
            <button
              className={styles.searchResultButton}
              type="button"
              key={node.id}
              onClick={() => handleSearchResultClick(node)}
            >
              {node.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.stageWrap}>
        <div className={styles.stage} ref={stageRef} aria-label="书籍知识图谱 Sigma 画布" />
      </div>

      <div className={styles.nodeInfo}>
        <p className={styles.nodeLabel}>{activeNode?.label ?? '悬浮或点击节点查看关系'}</p>
        {activeNode && (
          <div className={styles.nodeMeta}>
            <span className={styles.nodePill}>{getNodeTypeLabel(activeNode.nodeType)}</span>
            <span className={styles.nodePill}>{activeNode.id}</span>
          </div>
        )}
      </div>
    </div>
  )
}
