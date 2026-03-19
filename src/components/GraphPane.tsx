import { useEffect, useCallback, useRef, useState } from 'react'
import { instance } from '@viz-js/viz'
import { getGraph } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import { ErrorBanner } from './ErrorBanner'
import type { PipelineEvent } from '../api/types'

// ---------------------------------------------------------------------------
// Color palette for node states
// ---------------------------------------------------------------------------

interface NodeColorEntry {
  fill: string
  textFill: string
}

const NODE_COLORS: Record<string, NodeColorEntry> = {
  green:  { fill: '#22c55e', textFill: '#1a1a2e' }, // completed — light green, dark text
  yellow: { fill: '#eab308', textFill: '#1a1a2e' }, // running   — amber, dark text
  red:    { fill: '#ef4444', textFill: '#e2e8f0' }, // failed    — red, light text
}

// ---------------------------------------------------------------------------
// SVG preprocessing helpers (no post-render DOM manipulation)
// ---------------------------------------------------------------------------

function injectRankdirTB(dot: string): string {
  if (/rankdir\s*=/.test(dot)) {
    return dot.replace(/rankdir\s*=\s*\w+/g, 'rankdir=TB')
  }
  return dot.replace('{', '{\n  rankdir=TB;')
}

/**
 * Apply dark-theme base styling via string preprocessing — survives
 * dangerouslySetInnerHTML re-renders without post-render DOM manipulation.
 */
function applyDarkTheme(svg: string): string {
  let result = svg.replace(/<svg\b([^>]*)>/, (_match, attrs) => {
    const cleaned = attrs
      .replace(/\s*style="[^"]*"/g, '')
      .replace(/\s*width="[^"]*pt"/, '')
      .replace(/\s*height="[^"]*pt"/, '')
      .replace(/\s*preserveAspectRatio="[^"]*"/, '')
    return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="background:transparent">`
  })
  // Remove Graphviz's white background polygon (UI-BUG-013)
  result = result.replace(/fill="white"/g, 'fill="transparent"')
  // Replace only black text fills with readable medium gray (UI-BUG-014).
  result = result.replace(
    /<text([^>]*)fill="(black|#000000)"([^>]*)>/g,
    '<text$1fill="#9ca3af"$3>',
  )
  // Catch text elements with no explicit fill (edge labels default to black)
  result = result.replace(/<text\b(?![^>]*fill=)([^>]*?)>/g, '<text fill="#9ca3af"$1>')
  // Light edge strokes and arrowhead fills.
  result = result
    .replace(/stroke="black"/g, 'stroke="#9ca3af"')
    .replace(/stroke="#000000"/g, 'stroke="#9ca3af"')
    .replace(/fill="black"/g, 'fill="#9ca3af"')
  return result
}

/**
 * Apply per-node status colors via DOMParser before setting innerHTML.
 * Also applies selection outline to the selected node.
 */
function applyNodeColorsToSvg(
  svg: string,
  pipelineEvents: PipelineEvent[],
  selectedNodeId?: string | null,
): string {
  if (!svg) return svg

  const nodeColorKeys = new Map<string, string>()
  for (const event of pipelineEvents) {
    if (event.event === 'stage_completed') nodeColorKeys.set(event.name, 'green')
    else if (event.event === 'stage_started') nodeColorKeys.set(event.name, 'yellow')
    else if (event.event === 'stage_failed') nodeColorKeys.set(event.name, 'red')
    // UI-BUG-021: Color parallel branch nodes using the `branch` field
    else if (event.event === 'parallel_branch_started') nodeColorKeys.set(event.branch, 'yellow')
    else if (event.event === 'parallel_branch_completed') nodeColorKeys.set(event.branch, event.success ? 'green' : 'red')
  }
  // Color terminal nodes green when pipeline completes.
  const hasCompleted = pipelineEvents.some((e) => e.event === 'pipeline_completed')
  if (hasCompleted) {
    for (const name of ['Exit', 'Finish', 'End']) {
      nodeColorKeys.set(name, 'green')
    }
  }

  // Need to parse the DOM even if no color keys, because we may have a selection outline
  const needsParsing = nodeColorKeys.size > 0 || !!selectedNodeId
  if (!needsParsing) return svg

  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const svgEl = doc.documentElement

  for (const title of svgEl.querySelectorAll('title')) {
    const nodeId = title.textContent?.trim() ?? ''
    const g = title.closest('g')
    if (!g) continue

    // Apply status color
    const colorKey = nodeColorKeys.get(nodeId)
    if (colorKey) {
      const colorEntry = NODE_COLORS[colorKey]
      if (colorEntry) {
        const shape = g.querySelector('polygon, ellipse')
        if (shape) shape.setAttribute('fill', colorEntry.fill)
        g.querySelectorAll('text').forEach((t) => t.setAttribute('fill', colorEntry.textFill))
        // Legacy: keep g.style.fill for tests that check it
        g.setAttribute('style', `fill: ${colorKey}`)
      }
    }

    // Task 2e: Apply strong selection outline to the selected node
    if (selectedNodeId && nodeId === selectedNodeId) {
      const shape = g.querySelector('polygon, ellipse, rect')
      if (shape) {
        shape.setAttribute('stroke', '#3b82f6')
        shape.setAttribute('stroke-width', '3')
      }
    } else if (selectedNodeId) {
      // Clear selection outline from non-selected nodes (in case it was previously set)
      const shape = g.querySelector('polygon, ellipse, rect')
      if (shape && shape.getAttribute('stroke') === '#3b82f6') {
        // Reset to default gray edge stroke
        shape.setAttribute('stroke', '#9ca3af')
        shape.setAttribute('stroke-width', '1')
      }
    }
  }

  return new XMLSerializer().serializeToString(doc)
}

function processSvg(
  rawSvg: string,
  pipelineEvents: PipelineEvent[],
  selectedNodeId?: string | null,
): string {
  return applyNodeColorsToSvg(applyDarkTheme(rawSvg), pipelineEvents, selectedNodeId)
}

// ---------------------------------------------------------------------------
// GraphPane component — architectural rewrite (UI-BUG-012)
//
// Core architectural decisions that avoid React 19 dangerouslySetInnerHTML reset:
//  1. SVG preprocessing (dark theme + node colors) done BEFORE setting innerHTML
//  2. Drag handlers use ZERO React state updates — cursor changed imperatively
//  3. Only scale + svgContent changes trigger re-renders
//  4. CSS transform: scale() for zoom (not container resize)
// ---------------------------------------------------------------------------

export function GraphPane() {
  const { activePipelineId, events, selectNode, selectedNodeId } = usePipelineStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)

  // Keep events + selectedNodeId refs for use inside renderDot without adding as dependencies
  const eventsRef = useRef(events)
  eventsRef.current = events
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId

  const originalSvgRef = useRef<string>('')
  const [svgContent, setSvgContent] = useState<string>('')
  const [renderError, setRenderError] = useState<string | null>(null)
  // Task 2c: default scale 0.75 (slightly small rather than too big)
  const [scale, setScale] = useState(0.75)

  // Drag state — ALL in refs, zero React state updates, so mouseDown never
  // triggers a re-render that would reset dangerouslySetInnerHTML.
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef<{
    x: number; y: number; scrollLeft: number; scrollTop: number
  } | null>(null)

  // Fetch DOT, render SVG, and process in a single setSvgContent call.
  const renderDot = useCallback(async (pipelineId: string) => {
    setRenderError(null)
    const { dot } = await getGraph(pipelineId)
    const viz = await instance()
    const raw = viz.renderString(injectRankdirTB(dot), { format: 'svg' })
    originalSvgRef.current = raw
    const pipelineEvents = eventsRef.current.get(pipelineId) ?? []
    setSvgContent(processSvg(raw, pipelineEvents, selectedNodeIdRef.current))
    setScale(0.75) // Task 2c: reset to 0.75 on new pipeline load
  }, [])

  useEffect(() => {
    if (activePipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      renderDot(activePipelineId).catch((err) => {
        setRenderError(err instanceof Error ? err.message : 'Failed to render graph')
      })
    } else {
      originalSvgRef.current = ''
      setSvgContent('')
      setRenderError(null)
    }
  }, [activePipelineId, renderDot])

  // Recolor SVG when pipeline events change after initial load, or when selection changes
  useEffect(() => {
    if (!originalSvgRef.current || !activePipelineId) return
    const pipelineEvents = events.get(activePipelineId) ?? []
    setSvgContent(processSvg(originalSvgRef.current, pipelineEvents, selectedNodeId))
  }, [events, activePipelineId, selectedNodeId])

  // Task 2a: Mouse scroll zoom — non-passive listener so preventDefault works
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      // Scroll up (negative deltaY) = zoom in; scroll down = zoom out
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setScale((s) => Math.min(Math.max(s + delta, 0.1), 3.0))
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // Click handler — select node on click, clear on empty space click
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingRef.current) return
      const g = (e.target as Element).closest('g')
      if (g) {
        const title = g.querySelector('title')
        if (title?.textContent) {
          selectNode(title.textContent)
          return
        }
      }
      // Task 2e: clear selection when clicking empty space
      selectNode(null)
    },
    [selectNode],
  )

  // Drag-to-pan: imperatively set cursor, never call setState.
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    isDraggingRef.current = false
    dragStartRef.current = {
      x: e.clientX, y: e.clientY,
      scrollLeft: container.scrollLeft, scrollTop: container.scrollTop,
    }
    // Imperatively update cursor — no setState, no re-render
    if (scalerRef.current) scalerRef.current.style.cursor = 'grabbing'
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      isDraggingRef.current = true
      e.preventDefault()
      const container = containerRef.current
      if (container) {
        container.scrollLeft = dragStartRef.current.scrollLeft - dx
        container.scrollTop = dragStartRef.current.scrollTop - dy
      }
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    dragStartRef.current = null
    if (scalerRef.current) scalerRef.current.style.cursor = 'grab'
    // Reset isDragging after click event has been processed
    setTimeout(() => { isDraggingRef.current = false }, 0)
  }, [])

  if (!activePipelineId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        Select a pipeline
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col relative">
      {renderError && (
        <div className="p-2">
          <ErrorBanner message={renderError} variant="error" />
        </div>
      )}

      {/* Zoom controls — Task 2b: Fit button removed (unreliable with SVG 100%/100%) */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          aria-label="Zoom in" title="Zoom in"
          className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold flex items-center justify-center"
          onClick={() => setScale((s) => Math.min(s * 1.25, 3.0))}
        >+</button>
        <button
          aria-label="Zoom out" title="Zoom out"
          className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold flex items-center justify-center"
          onClick={() => setScale((s) => Math.max(s / 1.25, 0.1))}
        >−</button>
        <button
          aria-label="Reset zoom" title="Reset zoom to 75%"
          className="px-2 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium flex items-center justify-center"
          onClick={() => setScale(0.75)}
        >Reset</button>
      </div>

      {/* Scrollable outer container — Task 2d: p-8 for generous breathing room */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-900 p-8"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      >
        {/* CSS transform scaler — zoom via scale(), cursor via imperative DOM, no re-renders */}
        <div
          ref={scalerRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            cursor: 'grab',
            display: 'inline-block',
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    </div>
  )
}
