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
// Cover-fit pure helpers — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Extract the intrinsic pixel dimensions from a raw Graphviz SVG string.
 * Graphviz emits `width="741pt" height="1772pt"` — we convert pt → px
 * (1 pt = 1.333 px at 96 dpi / 72 dpi) so callers can compute a cover-fit
 * scale without relying on live DOM measurements of the SVG element.
 *
 * Returns null if the SVG has no pt-unit dimensions (e.g. already processed).
 */
export function extractSvgDimensions(
  svg: string,
): { widthPx: number; heightPx: number } | null {
  const match = svg.match(/width="([\d.]+)pt"[^>]*height="([\d.]+)pt"/)
  if (!match) return null
  const PT_TO_PX = 1.333 // 96 dpi ÷ 72 dpi
  return {
    widthPx: parseFloat(match[1]) * PT_TO_PX,
    heightPx: parseFloat(match[2]) * PT_TO_PX,
  }
}

/**
 * Compute the initial scale and pan for a "cover-fit" view:
 * - Portrait graph (taller than wide relative to the container): fill width,
 *   align the top of the graph to the top of the container.
 * - Landscape graph (wider than tall relative to container): fill height,
 *   align the left of the graph to the left edge of the container.
 *
 * Pan is always { x: 0, y: 0 } — the transform-origin is top-left, so the
 * graph's top-left corner sits at the container's top-left after translation.
 */
export function computeCoverFit(
  graphWidthPx: number,
  graphHeightPx: number,
  containerWidth: number,
  containerHeight: number,
): { scale: number; pan: { x: number; y: number } } {
  const graphAspect = graphHeightPx / graphWidthPx
  const containerAspect = containerHeight / containerWidth

  const scale =
    graphAspect > containerAspect
      ? containerWidth / graphWidthPx   // portrait: fill width
      : containerHeight / graphHeightPx // landscape: fill height

  return { scale, pan: { x: 0, y: 0 } }
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
 *
 * Sets explicit pixel dimensions on the SVG (converted from Graphviz's pt
 * units) so that CSS `transform: scale()` operates against a known, fixed size
 * rather than the container's 100% dimensions.
 */
function applyDarkTheme(svg: string): string {
  let result = svg.replace(/<svg\b([^>]*)>/, (_match, attrs) => {
    // Extract pt dimensions before stripping them — use for explicit px sizing
    const wMatch = attrs.match(/width="([\d.]+)pt"/)
    const hMatch = attrs.match(/height="([\d.]+)pt"/)
    const PT_TO_PX = 1.333
    const widthPx = wMatch ? Math.round(parseFloat(wMatch[1]) * PT_TO_PX) : undefined
    const heightPx = hMatch ? Math.round(parseFloat(hMatch[1]) * PT_TO_PX) : undefined

    const cleaned = attrs
      .replace(/\s*style="[^"]*"/g, '')
      .replace(/\s*width="[^"]*pt"/, '')
      .replace(/\s*height="[^"]*pt"/, '')
      .replace(/\s*preserveAspectRatio="[^"]*"/, '')

    // Use explicit pixel dimensions so CSS transform: scale() is predictable.
    // Fall back to 100%/100% only if no pt dimensions were present.
    const sizeAttrs =
      widthPx && heightPx
        ? `width="${widthPx}" height="${heightPx}"`
        : 'width="100%" height="100%"'

    return `<svg${cleaned} ${sizeAttrs} preserveAspectRatio="xMidYMid meet" style="background:transparent">`
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
  // Intrinsic graph dimensions extracted from the raw Graphviz SVG (in px).
  // Used by the cover-fit useEffect and the Reset handler.
  const graphDimsRef = useRef<{ widthPx: number; heightPx: number } | null>(null)

  const [svgContent, setSvgContent] = useState<string>('')
  const [renderError, setRenderError] = useState<string | null>(null)
  // Initial scale of 1.5 is the JSDOM / no-layout fallback.
  // In a real browser the cover-fit useEffect overrides this after the first render.
  const [scale, setScale] = useState(1.5)
  // Step 1: Pan state for trackpad two-finger scroll and click-drag
  const [pan, setPan] = useState({ x: 0, y: 0 })

  // Drag state — ALL in refs, zero React state updates, so mouseDown never
  // triggers a re-render that would reset dangerouslySetInnerHTML.
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef<{
    x: number; y: number; startPanX: number; startPanY: number
  } | null>(null)
  // Keep a ref to pan for use inside mouse handlers without adding pan as dep
  const panRef = useRef(pan)
  panRef.current = pan

  // Fetch DOT, render SVG, and process in a single setSvgContent call.
  const renderDot = useCallback(async (pipelineId: string) => {
    setRenderError(null)
    const { dot } = await getGraph(pipelineId)
    const viz = await instance()
    const raw = viz.renderString(injectRankdirTB(dot), { format: 'svg' })
    originalSvgRef.current = raw
    // Extract intrinsic dimensions from the raw SVG before applyDarkTheme strips them.
    graphDimsRef.current = extractSvgDimensions(raw)
    const pipelineEvents = eventsRef.current.get(pipelineId) ?? []
    setSvgContent(processSvg(raw, pipelineEvents, selectedNodeIdRef.current))
    // NOTE: setScale intentionally omitted here — the cover-fit useEffect below
    // computes the correct initial scale from container + graph dimensions.
    // In JSDOM / zero-layout environments it skips and leaves useState's 1.5.
    setPan({ x: 0, y: 0 }) // Step 6: reset pan on pipeline change
  }, [])

  useEffect(() => {
    if (activePipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      renderDot(activePipelineId).catch((err) => {
        setRenderError(err instanceof Error ? err.message : 'Failed to render graph')
      })
    } else {
      originalSvgRef.current = ''
      graphDimsRef.current = null
      setSvgContent('')
      setRenderError(null)
    }
  }, [activePipelineId, renderDot])

  // Cover-fit: compute initial scale/pan after the SVG renders so the graph
  // fills the available space with the start node visible.
  useEffect(() => {
    if (!svgContent) return
    const container = containerRef.current
    const dims = graphDimsRef.current
    if (!container || !dims) return

    const rect = container.getBoundingClientRect()
    // p-8 = 32px padding on each side → 64px total per axis
    const cw = rect.width - 64
    const ch = rect.height - 64
    // Guard: JSDOM returns 0×0; skip cover-fit so the 1.5 fallback stays.
    if (cw <= 0 || ch <= 0) return

    const { scale: fitScale, pan: fitPan } = computeCoverFit(
      dims.widthPx, dims.heightPx, cw, ch,
    )
    setScale(fitScale)
    setPan(fitPan)
  }, [svgContent]) // runs whenever the SVG content changes (new pipeline loaded)

  // Recolor SVG when pipeline events change after initial load, or when selection changes
  useEffect(() => {
    if (!originalSvgRef.current || !activePipelineId) return
    const pipelineEvents = events.get(activePipelineId) ?? []
    setSvgContent(processSvg(originalSvgRef.current, pipelineEvents, selectedNodeId))
  }, [events, activePipelineId, selectedNodeId])

  // Step 2: Dual input wheel handler — distinguishes pinch, trackpad scroll, mouse wheel
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()

      if (e.ctrlKey) {
        // Pinch-to-zoom (trackpad) OR Ctrl+scroll (mouse)
        // deltaY is small and fractional for pinch
        const rect = container.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        const zoomDelta = -e.deltaY * 0.01
        setScale(prevScale => {
          const newScale = Math.min(Math.max(prevScale + zoomDelta, 0.1), 5.0)
          // Zoom toward cursor: keep the graph point under the mouse fixed
          const graphX = (mouseX - panRef.current.x) / prevScale
          const graphY = (mouseY - panRef.current.y) / prevScale
          setPan({
            x: mouseX - graphX * newScale,
            y: mouseY - graphY * newScale,
          })
          return newScale
        })
      } else if (e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0)) {
        // Discrete mouse wheel: line-based deltaMode OR large Y-only jumps
        const rect = container.getBoundingClientRect()
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        const delta = e.deltaY > 0 ? -0.15 : 0.15
        setScale(prevScale => {
          const newScale = Math.min(Math.max(prevScale + delta, 0.1), 5.0)
          // Zoom toward cursor: keep the graph point under the mouse fixed
          const graphX = (mouseX - panRef.current.x) / prevScale
          const graphY = (mouseY - panRef.current.y) / prevScale
          setPan({
            x: mouseX - graphX * newScale,
            y: mouseY - graphY * newScale,
          })
          return newScale
        })
      } else {
        // Trackpad two-finger scroll: small pixel-based deltas on both axes
        setPan(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }))
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [activePipelineId])

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

  // Step 4: Drag-to-pan using pan state (no native scrolling — container is overflow:hidden)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = false
    dragStartRef.current = {
      x: e.clientX, y: e.clientY,
      startPanX: panRef.current.x, startPanY: panRef.current.y,
    }
    // Set cursor on container (covers area outside the SVG scaler during drag)
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
    if (scalerRef.current) scalerRef.current.style.cursor = 'grabbing'
    // Prevent text selection anywhere on the page while dragging
    document.body.style.userSelect = 'none'
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      isDraggingRef.current = true
      e.preventDefault()
      setPan({
        x: dragStartRef.current.startPanX + dx,
        y: dragStartRef.current.startPanY + dy,
      })
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    dragStartRef.current = null
    if (containerRef.current) containerRef.current.style.cursor = 'grab'
    if (scalerRef.current) scalerRef.current.style.cursor = 'grab'
    // Re-enable text selection after drag ends
    document.body.style.userSelect = ''
    // Reset isDragging after click event has been processed
    setTimeout(() => { isDraggingRef.current = false }, 0)
  }, [])

  // Reset handler: apply cover-fit when container has real dimensions,
  // fall back to scale=1.5 + pan=0 (JSDOM / zero-layout environments).
  const handleReset = useCallback(() => {
    const container = containerRef.current
    const dims = graphDimsRef.current
    if (!container || !dims) {
      setPan({ x: 0, y: 0 })
      setScale(1.5)
      return
    }
    const rect = container.getBoundingClientRect()
    const cw = rect.width - 64
    const ch = rect.height - 64
    if (cw <= 0 || ch <= 0) {
      // JSDOM / no-layout fallback
      setPan({ x: 0, y: 0 })
      setScale(1.5)
      return
    }
    const { scale: fitScale, pan: fitPan } = computeCoverFit(
      dims.widthPx, dims.heightPx, cw, ch,
    )
    setScale(fitScale)
    setPan(fitPan)
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
          onClick={() => setScale((s) => Math.min(s * 1.25, 5.0))}
        >+</button>
        <button
          aria-label="Zoom out" title="Zoom out"
          className="w-7 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold flex items-center justify-center"
          onClick={() => setScale((s) => Math.max(s / 1.25, 0.1))}
        >−</button>
        <button
          aria-label="Reset zoom" title="Reset zoom to cover fit"
          className="px-2 h-7 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium flex items-center justify-center"
          onClick={handleReset}
        >Reset</button>
      </div>

      {/* Scrollable outer container — Task 2d: p-8 for generous breathing room */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-gray-900 p-8"
        style={{ cursor: 'grab' }}
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
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            display: 'inline-block',
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    </div>
  )
}
