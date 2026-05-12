import { useEffect, useRef } from 'react'
import { UndirectedGraph } from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import Sigma from 'sigma'
import { create } from 'zustand'

import { queryGraph } from '../services'
import type { GraphNodeType, GraphQueryRequest, GraphResponse } from '../types'

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

type GraphStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

type KnowledgeGraphStore = {
  graphResponse: GraphResponse | null
  status: GraphStatus
  errorMessage: string
  setLoading: () => void
  setGraphResponse: (graphResponse: GraphResponse) => void
  setEmpty: (message: string) => void
  setError: (message: string) => void
  resetGraph: () => void
}

const focusedCameraRatio = 0.55
const minCameraRatio = 0.05
const maxCameraRatio = 8

const nodeTypeColorMap: Record<string, string> = {
  artifact: '#d4af37',
  dynasty: '#b8873a',
  material: '#0f766e',
  category: '#7f4f24',
  pattern: '#2d5f83',
  site: '#256d85',
  craft: '#0d6157',
  inscription: '#9a6b2f',
  usage: '#6a5a3c',
  concept: '#71717b',
  person: '#8b5cf6',
  collection: '#a16207',
  other: '#71717b',
}

const edgeLabelMap: Record<string, string> = {
  involves_entity: '涉及实体',
  has_facet: '包含方面',
  has_point: '包含要点',
}

const useKnowledgeGraphStore = create<KnowledgeGraphStore>((set) => ({
  graphResponse: null,
  status: 'idle',
  errorMessage: '',
  setLoading: () => set({ status: 'loading', errorMessage: '' }),
  setGraphResponse: (graphResponse) => set({ graphResponse, status: 'ready', errorMessage: '' }),
  setEmpty: (message) => set({ graphResponse: null, status: 'empty', errorMessage: message }),
  setError: (message) => set({ status: 'error', errorMessage: message }),
  resetGraph: () => set({ graphResponse: null, status: 'idle', errorMessage: '' }),
}))

function getNodeColor(nodeType: GraphNodeType) {
  return nodeTypeColorMap[nodeType] ?? nodeTypeColorMap.other
}

function getNodeSize(nodeType: GraphNodeType, isCenterNode: boolean, degree: number) {
  if (isCenterNode || nodeType === 'artifact') {
    return 13
  }

  return Math.min(9, 5 + degree * 0.5)
}

function getEdgeLabel(label: string) {
  return edgeLabelMap[label] ?? label
}

function buildGraph(graphResponse: GraphResponse | null) {
  const graph = new UndirectedGraph<NodeAttributes, EdgeAttributes>()

  if (!graphResponse) {
    return graph
  }

  const degrees = graphResponse.edges.reduce<Record<string, number>>((accumulator, edge) => {
    accumulator[edge.source] = (accumulator[edge.source] ?? 0) + 1
    accumulator[edge.target] = (accumulator[edge.target] ?? 0) + 1

    return accumulator
  }, {})

  graphResponse.nodes.forEach((node, index) => {
    const isCenterNode = node.id === graphResponse.centerNodeId

    graph.addNode(node.id, {
      label: node.label,
      size: getNodeSize(node.nodeType, isCenterNode, degrees[node.id] ?? 0),
      color: getNodeColor(node.nodeType),
      x: isCenterNode ? 0 : Math.cos(index * 2.399963) * (7 + index * 0.24),
      y: isCenterNode ? 0 : Math.sin(index * 2.399963) * (7 + index * 0.24),
    })
  })

  graphResponse.edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target) || graph.hasEdge(edge.id)) {
      return
    }

    const weight = edge.weight ?? 1

    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      label: getEdgeLabel(edge.label),
      weight,
      size: weight * 2,
      color: 'rgba(106, 90, 60, 0.78)',
    })
  })

  if (graph.order > 1) {
    forceAtlas2.assign(graph, {
      iterations: 160,
      settings: {
        gravity: 1.25,
        scalingRatio: 5,
        slowDown: 8,
        edgeWeightInfluence: 0.85,
      },
    })
  }

  return graph
}

function getErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    const detail = response?.data?.detail

    if (typeof detail === 'string') {
      return detail
    }
  }

  return '知识图谱接口请求失败，请稍后重试。'
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (typeof error === 'object' && error) {
    const maybeCanceledError = error as { code?: unknown; name?: unknown }

    return maybeCanceledError.code === 'ERR_CANCELED' || maybeCanceledError.name === 'CanceledError'
  }

  return false
}

export async function requestKnowledgeGraph(request: GraphQueryRequest, signal?: AbortSignal) {
  const { setLoading, setGraphResponse, setEmpty, setError } = useKnowledgeGraphStore.getState()

  setLoading()

  try {
    const graphResponse = await queryGraph(request, { signal })
    setGraphResponse(graphResponse)
  } catch (error) {
    if (isAbortError(error)) {
      return
    }

    const message = getErrorMessage(error)

    if (typeof error === 'object' && error && 'response' in error) {
      const status = (error as { response?: { status?: number } }).response?.status

      if (status === 404) {
        setEmpty(message)
        return
      }
    }

    setError(message)
  }
}

export function useKnowledgeGraphStoreController() {
  const graphResponse = useKnowledgeGraphStore((state) => state.graphResponse)
  const status = useKnowledgeGraphStore((state) => state.status)
  const errorMessage = useKnowledgeGraphStore((state) => state.errorMessage)
  const graphRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapContainerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLDivElement>(null)
  const minimapViewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !minimapContainerRef.current || !minimapRef.current) return

    const graph = buildGraph(graphResponse)
    const renderer = new Sigma(graph, containerRef.current, {
      allowInvalidContainer: true,
      autoCenter: true,
      autoRescale: true,
      defaultEdgeColor: 'rgba(106, 90, 60, 0.76)',
      defaultEdgeType: 'line',
      edgeLabelColor: { color: '#8d7a55' },
      edgeLabelSize: 11,
      edgeLabelWeight: '500',
      labelColor: { color: '#d4d4d8' },
      labelDensity: 0.25,
      labelFont: 'Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif',
      labelRenderedSizeThreshold: 6,
      labelSize: 13,
      labelWeight: '600',
      maxCameraRatio,
      minCameraRatio,
      renderEdgeLabels: true,
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
      stagePadding: 20,
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
      if (width <= 1 || height <= 1 || graph.order === 0) return

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
  }, [graphResponse])

  return {
    graphRef,
    containerRef,
    minimapContainerRef,
    minimapRef,
    minimapViewportRef,
    status,
    errorMessage,
  }
}
