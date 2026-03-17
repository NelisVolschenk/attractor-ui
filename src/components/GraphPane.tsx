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
  // The old code replaced ALL text fills with #e2e8f0 (light gray), making node
  // labels unreadable on colored boxes.  Instead we only target black/#000000
  // (Graphviz defaults for edge labels and pending-node labels).
  // applyNodeColorsToSvg will later override colored-node text with the
  // per-color textFill (dark on green/yellow, light on red).
  result = result.replace(
    /<text([^>]*)fill="(black|#000000)"([^>]*)>/g,
    '<text$1fill="#9ca3af"$3>',
  )
  // Catch text elements with no explicit fill (edge labels default to black)
  result = result.replace(/<text\b(?![^>]*fill=)([^>]*?)>/g, '<text fill="#9ca3af"$1>')
  // Light edge strokes and arrowhead fills.
  // NOTE: no \b anchors — the trailing \b after a closing " never matches
  // because " is a non-word char followed by another non-word char (space / >).
  // The old \b-anchored regexes matched ZERO times against real viz.js output.
  result = result
    .replace(/stroke="black"/g, 'stroke="#9ca3af"')
    .replace(/stroke="#000000"/g, 'stroke="#9ca3af"')
    .replace(/fill="black"/g, 'fill="#9ca3af"')
  return result
}

/**
 * Apply per-node status colors via DOMParser before setting innerHTML.
 */
function applyNodeColorsToSvg(svg: string, pipelineEvents: PipelineEvent[]): string {
  if (!svg) return svg

  const nodeColorKeys = new Map<string, string>()
  for (const event of pipelineEvents) {
    if (event.event === 'stage_completed') nodeColorKeys.set(event.name, 'green')
    else if (event.event === 'stage_started') nodeColorKeys.set(event.name, 'yellow')
    else if (event.event === 'stage_failed') nodeColorKeys.set(event.name, 'red')
  }
  if (nodeColorKeys.size === 0) return svg

  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const svgEl = doc.documentElement

  for (const title of svgEl.querySelectorAll('title')) {
    const nodeId = title.textContent?.trim() ?? ''
    const colorKey = nodeColorKeys.get(nodeId)
    if (!colorKey) continue
    const colorEntry = NODE_COLORS[colorKey]
    if (!colorEntry) continue
    const g = title.closest('g')
    if (!g) continue

    const shape = g.querySelector('polygon, ellipse')
    if (shape) shape.setAttribute('fill', colorEntry.fill)
    g.querySelectorAll('text').forEach((t) => t.setAttribute('fill', colorEntry.textFill))
    // Legacy: keep g.style.fill for tests that check it
    g.setAttribute('style', `fill: ${colorKey}`)
  }

  return new XMLSerializer().serializeToString(doc)
}

function processSvg(rawSvg: string, pipelineEvents: PipelineEvent[]): string {
  return applyNodeColorsToSvg(applyDarkTheme(rawSvg), pipelineEvents)
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
  const { activePipelineId, events, selectNode } = usePipelineStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)

  // Keep events ref for use inside renderDot without adding it as dependency
  const eventsRef = useRef(events)
  eventsRef.current = events

  const originalSvgRef = useRef<string>('')
  const [svgContent, setSvgContent] = useState<string>('')
  const [renderError, setRenderError] = useState<string | null>(null)
  const [scale, setScale] = useState(1.0)

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
    setSvgContent(processSvg(raw, pipelineEvents))
    setScale(1.0)
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

  // Recolor SVG when pipeline events change after initial load
  useEffect(() => {
    if (!originalSvgRef.current || !activePipelineId) return
    const pipelineEvents = events.get(activePipelineId) ?? []
    setSvgContent(processSvg(originalSvgRef.current, pipelineEvents))
  }, [events, activePipelineId])

  const fitToViewport = useCallback(() => {
    const container = containerRef.current
    if (!container) { setScale(1.0); return }
    const svgEl = container.querySelector('svg')
    if (!svgEl) { setScale(1.0); return }
    const containerW = container.clientWidth - 32
    const containerH = container.clientHeight - 32
    const svgW = svgEl.scrollWidth || svgEl.getBoundingClientRect().width
    const svgH = svgEl.scrollHeight || svgEl.getBoundingClientRect().height
    if (svgW <= 0 || svgH <= 0) { setScale(1.0); return }
    setScale(Math.max(Math.min(containerW / svgW, containerH / svgH, 1.0), 0.1))
  }, [])

  // Click handler — NO state updates, just delegates to selectNode
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingRef.current) return
      const g = (e.target as Element).closest('g')
      if (g) {
        const title = g.querySelector('title')
        if (title?.textContent) selectNode(title.textContent)
      }
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

      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          aria-label="Zoom in" title="Zoom in"
          className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold flex items-center justify-center"
          onClick={() => setScale((s) => Math.min(s * 1.25, 6))}
        >+</button>
        <button
          aria-label="Zoom out" title="Zoom out"
          className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold flex items-center justify-center"
          onClick={() => setScale((s) => Math.max(s / 1.25, 0.1))}
        >−</button>
        <button
          aria-label="Fit graph" title="Fit graph"
          className="px-2 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium flex items-center justify-center"
          onClick={fitToViewport}
        >Fit</button>
      </div>

      {/* Scrollable outer container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-900 p-4"
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
