import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineEvent } from '../api/types'
import { extractSvgDimensions, computeCoverFit } from '../components/GraphPane'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const mockRenderString = vi.hoisted(() =>
  vi.fn().mockReturnValue('<svg><g id="node1"><title>nodeA</title></g></svg>'),
)

const mockGetGraph = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ dot: 'digraph { a -> b }', format: 'dot' }),
)

const mockActivePipelineId = vi.hoisted(() => ({ current: null as string | null }))
const mockEvents = vi.hoisted(() => ({ current: new Map<string, PipelineEvent[]>() }))
const mockSelectNode = vi.hoisted(() => vi.fn())

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@viz-js/viz', () => ({
  instance: vi.fn().mockResolvedValue({
    renderString: mockRenderString,
  }),
}))

vi.mock('../api/client', () => ({
  getGraph: mockGetGraph,
}))

vi.mock('../store/pipelines', () => ({
  usePipelineStore: () => ({
    activePipelineId: mockActivePipelineId.current,
    events: mockEvents.current,
    selectNode: mockSelectNode,
  }),
}))

// Import after mocks are set up
import { GraphPane } from '../components/GraphPane'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphPane', () => {
  beforeEach(() => {
    mockActivePipelineId.current = null
    mockEvents.current = new Map()
    mockSelectNode.mockClear()
    mockGetGraph.mockClear()
    mockRenderString.mockClear()
    mockRenderString.mockReturnValue('<svg><g id="node1"><title>nodeA</title></g></svg>')
  })

  it("shows 'Select a pipeline' when no active pipeline", () => {
    render(<GraphPane />)
    expect(screen.getByText('Select a pipeline')).toBeInTheDocument()
  })

  it('calls getGraph and renders SVG when activePipelineId is set', async () => {
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(mockGetGraph).toHaveBeenCalledWith('pipe-1')
    })

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  it('calls renderString with { format: "svg" } to produce SVG output', async () => {
    mockActivePipelineId.current = 'pipe-1'

    render(<GraphPane />)

    await waitFor(() => {
      // The DOT string passed to renderString may be modified (e.g. rankdir
      // injection) so only verify the format option, not the exact DOT source.
      expect(mockRenderString).toHaveBeenCalledWith(
        expect.any(String),
        { format: 'svg' },
      )
    })
  })

  it('injects rankdir=TB into the DOT source for vertical layout (UI-FEAT-004)', async () => {
    mockActivePipelineId.current = 'pipe-1'

    render(<GraphPane />)

    await waitFor(() => {
      const dotArg = mockRenderString.mock.calls[0]?.[0] as string
      expect(dotArg).toContain('rankdir=TB')
    })
  })

  it('graph container has dark background class (UI-FEAT-005)', async () => {
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // The graph container should have a dark bg (Fix B: overflow-hidden, not overflow-auto)
    const graphContainer = container.querySelector('.overflow-hidden')
    expect(graphContainer).toHaveClass('bg-gray-900')
  })

  it('applies green fill to completed nodes', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'stage_completed',
            name: 'nodeA',
            index: 0,
            duration: { __duration_ms: 100 },
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>nodeA</title></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const g = container.querySelector('g')
      expect(g?.style.fill).toBe('green')
    })
  })

  it('shows error banner when renderDot fails', async () => {
    mockActivePipelineId.current = 'pipe-fail'
    mockGetGraph.mockRejectedValueOnce(new Error('API unreachable'))

    render(<GraphPane />)

    await waitFor(() => {
      expect(screen.getByText('API unreachable')).toBeInTheDocument()
    })
  })

  it('sets preserveAspectRatio on SVG for viewport fit (UI-FEAT-010)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockRenderString.mockReturnValue(
      '<svg width="800pt" height="400pt" viewBox="0 0 800 400"><g id="node1"><title>nodeA</title></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const svgEl = container.querySelector('svg')
      expect(svgEl).toBeInTheDocument()
      expect(svgEl?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    })
  })

  it('renders zoom controls (UI-FEAT-010)', async () => {
    mockActivePipelineId.current = 'pipe-1'

    render(<GraphPane />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument()
      // Task 2b: Fit button removed (unreliable); replaced with Reset button
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
    })
  })

  it('completed node polygon has green fill, not the whole group (UI-FEAT-011)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'stage_completed',
            name: 'nodeA',
            index: 0,
            duration: { __duration_ms: 100 },
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>nodeA</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text>nodeA</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const polygon = container.querySelector('g polygon')
      // Polygon should have a colored fill (not white)
      expect(polygon?.getAttribute('fill')).not.toBe('#ffffff')
      expect(polygon?.getAttribute('fill')).toBeTruthy()
    })
  })

  it('completed node text has dark fill for readability on green background (UI-FEAT-011)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'stage_completed',
            name: 'nodeA',
            index: 0,
            duration: { __duration_ms: 100 },
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>nodeA</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="#e2e8f0">nodeA</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const text = container.querySelector('g text')
      // Text should have dark fill (not white/light) on green completed node
      const fill = text?.getAttribute('fill')
      expect(fill).toBe('#1a1a2e')
    })
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-012: Architectural fixes — CSS transform zoom + drag panning
  // ---------------------------------------------------------------------------

  it('UI-BUG-012: zoom-in button changes CSS transform scale, not container width', async () => {
    // RED: current code resizes the container div (width: 125%) instead of
    // using CSS transform scale.  This test verifies the correct behaviour.
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // Click zoom in
    const zoomIn = screen.getByRole('button', { name: /zoom in/i })
    await user.click(zoomIn)

    // The inner scaler div should use CSS transform, not width
    // Find a div that has a transform style (the SVG wrapper scaler)
    const scalerDiv = container.querySelector('[style*="scale"]')
    expect(scalerDiv).toBeInTheDocument()

    // The transform must contain scale(...), not have width > 100%
    const style = (scalerDiv as HTMLElement)?.style
    expect(style?.transform).toMatch(/scale/)
    // Container width should NOT be changed to > 100% (old broken approach)
    const oldWidthApproach = container.querySelector('[style*="width: 125"]')
    expect(oldWidthApproach).not.toBeInTheDocument()
  })

  it('UI-BUG-012: graph inner div has cursor:grab for drag panning support', async () => {
    // RED: current code has no cursor style on the graph container.
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // The SVG scaler/wrapper div should have cursor:grab (or grabbing when dragging)
    const grabDiv = container.querySelector('[style*="grab"]')
    expect(grabDiv).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-014: Text fill — only replace black text, not all fills
  // ---------------------------------------------------------------------------

  it('UI-BUG-014: pending node text fill is NOT #e2e8f0 (all-white was unreadable on colored boxes)', async () => {
    // The old code replaced ALL text fills with #e2e8f0 (light gray), which made
    // node labels unreadable on green/yellow colored boxes.
    // Fix: only replace black/#000000 text with #9ca3af (medium gray).
    // applyNodeColorsToSvg handles colored-node text separately.
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([['pipe-1', []]]) // no status events → pending
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>nodeA</title><polygon fill="#ffffff" stroke="black"/><text fill="black">nodeA</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const text = container.querySelector('g text')
    const fill = text?.getAttribute('fill')
    // Must NOT be the old all-white color that was illegible on colored nodes
    expect(fill).not.toBe('#e2e8f0')
    // Should be a readable medium gray
    expect(fill).toBe('#9ca3af')
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-013: SVG white background polygon → transparent
  // ---------------------------------------------------------------------------

  it('UI-BUG-013: Graphviz white background polygon fill becomes transparent', async () => {
    // Graphviz outputs <polygon fill="white" stroke="none"> as the first element
    // to create the graph background. This must become fill="transparent" so the
    // dark container bg-gray-900 shows through.
    mockActivePipelineId.current = 'pipe-1'
    mockRenderString.mockReturnValue(
      '<svg><polygon fill="white" stroke="none" points="0,0 100,0 100,100 0,100"/><g id="node1"><title>nodeA</title></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // The white polygon should now have fill="transparent", not fill="white"
    const polygon = container.querySelector('polygon')
    expect(polygon?.getAttribute('fill')).toBe('transparent')
    expect(polygon?.getAttribute('fill')).not.toBe('white')
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-017: \b word boundary anchors prevent stroke/fill replacement
  // ---------------------------------------------------------------------------

  it('UI-BUG-017: edge stroke="black" is replaced with #9ca3af (arrowhead color fix)', async () => {
    // The old regex used \b anchors that never matched in SVG attribute context.
    // e.g. /\bstroke="black"\b/g matches ZERO times against real viz.js output
    // because the trailing \b after the closing " finds no word boundary.
    mockActivePipelineId.current = 'pipe-1'
    mockRenderString.mockReturnValue(
      '<svg><g id="edge1"><title>Start->ExploreIdea</title>' +
      '<path stroke="black" fill="none" d="M100,100 L200,200"/>' +
      '<polygon stroke="black" fill="black" points="200,200 190,195 195,190"/>' +
      '</g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // Edge path stroke should be lightened — not black
    const path = container.querySelector('g path')
    expect(path?.getAttribute('stroke')).toBe('#9ca3af')

    // Arrowhead polygon stroke and fill should be lightened — not black
    const polygon = container.querySelector('g polygon')
    expect(polygon?.getAttribute('stroke')).toBe('#9ca3af')
    expect(polygon?.getAttribute('fill')).toBe('#9ca3af')
  })

  it('calls selectNode when a node g element is clicked', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>nodeA</title></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('g')).toBeInTheDocument()
    })

    await user.click(container.querySelector('g')!)

    expect(mockSelectNode).toHaveBeenCalledWith('nodeA')
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-021: Parallel branch graph coloring
  // ---------------------------------------------------------------------------

  it('UI-BUG-021: successful parallel branch node polygon has green fill (#22c55e)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'parallel_branch_completed',
            branch: 'FinalReviewOpus',
            index: 0,
            duration: { __duration_ms: 500 },
            success: true,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>FinalReviewOpus</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">FinalReviewOpus</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const polygon = container.querySelector('g polygon')
      expect(polygon?.getAttribute('fill')).toBe('#22c55e')
      const text = container.querySelector('g text')
      expect(text?.getAttribute('fill')).toBe('#1a1a2e')
    })
  })

  it('UI-BUG-021: failed parallel branch node polygon has red fill (#ef4444)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'parallel_branch_completed',
            branch: 'FinalReviewGPT',
            index: 1,
            duration: { __duration_ms: 300 },
            success: false,
            error: 'model error',
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>FinalReviewGPT</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">FinalReviewGPT</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const polygon = container.querySelector('g polygon')
      expect(polygon?.getAttribute('fill')).toBe('#ef4444')
      const text = container.querySelector('g text')
      expect(text?.getAttribute('fill')).toBe('#e2e8f0')
    })
  })

  it('UI-BUG-021: multiple parallel branches all get colored independently', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'parallel_branch_completed',
            branch: 'FinalReviewOpus',
            index: 0,
            duration: { __duration_ms: 500 },
            success: true,
          } as PipelineEvent,
          {
            event: 'parallel_branch_completed',
            branch: 'FinalReviewGPT',
            index: 1,
            duration: { __duration_ms: 300 },
            success: true,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg>' +
      '<g id="node1"><title>FinalReviewOpus</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">Opus</text></g>' +
      '<g id="node2"><title>FinalReviewGPT</title><polygon fill="#ffffff" stroke="black" points="100,200 200,200 200,250 100,250"/><text fill="black">GPT</text></g>' +
      '</svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const polygons = container.querySelectorAll('g polygon')
      // Both parallel branch node polygons should have green fill
      expect(polygons[0]?.getAttribute('fill')).toBe('#22c55e')
      expect(polygons[1]?.getAttribute('fill')).toBe('#22c55e')
    })
  })

  it('UI-BUG-021: parallel_branch_started colors node yellow (#eab308), completed overrides to green', async () => {
    // Tests the actual use case: started → completed in the same event list.
    // The completed event should override the started yellow with green.
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'parallel_branch_started',
            branch: 'FinalReviewOpus',
            index: 0,
          } as PipelineEvent,
          {
            event: 'parallel_branch_completed',
            branch: 'FinalReviewOpus',
            index: 0,
            duration: { __duration_ms: 500 },
            success: true,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>FinalReviewOpus</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">Opus</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      // Completed should override started — final color is green
      const polygon = container.querySelector('g polygon')
      expect(polygon?.getAttribute('fill')).toBe('#22c55e')
    })
  })

  // ---------------------------------------------------------------------------
  // Exit node green on pipeline_completed
  // ---------------------------------------------------------------------------

  it('colors Exit node polygon green (#22c55e) when pipeline_completed event is present', async () => {
    // RED: Exit node has no stage_completed event (engine never traverses it),
    // so without the fix it stays uncolored even after pipeline completes.
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'stage_completed',
            name: 'LastStage',
            index: 0,
            duration: { __duration_ms: 100 },
          } as PipelineEvent,
          {
            event: 'pipeline_completed',
            duration: { __duration_ms: 500 },
            artifact_count: 3,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg>' +
      '<g id="node1"><title>LastStage</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">LastStage</text></g>' +
      '<g id="node2"><title>Exit</title><polygon fill="#ffffff" stroke="black" points="100,200 200,200 200,250 100,250"/><text fill="black">Exit</text></g>' +
      '</svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const exitGroup = Array.from(container.querySelectorAll('g')).find(
        (g) => g.querySelector('title')?.textContent === 'Exit',
      )
      const polygon = exitGroup?.querySelector('polygon')
      expect(polygon?.getAttribute('fill')).toBe('#22c55e')
    })
  })

  it('colors Exit node green even when it is the only colored node (no stage events before pipeline_completed)', async () => {
    // Edge case: pipeline_completed arrives but nodeColorKeys would be empty
    // without the fix, causing an early return before Exit can be colored.
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'pipeline_completed',
            duration: { __duration_ms: 100 },
            artifact_count: 0,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>Exit</title><polygon fill="#ffffff" stroke="black" points="100,200 200,200 200,250 100,250"/><text fill="black">Exit</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const exitGroup = Array.from(container.querySelectorAll('g')).find(
        (g) => g.querySelector('title')?.textContent === 'Exit',
      )
      const polygon = exitGroup?.querySelector('polygon')
      expect(polygon?.getAttribute('fill')).toBe('#22c55e')
    })
  })

  // ---------------------------------------------------------------------------
  // Fix 2+3: Default scale 1.5, max zoom 5.0, Reset restores 1.5
  // ---------------------------------------------------------------------------

  it('Fix 3: Reset button restores scale to 1.5 (not 0.75)', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // Click zoom out to move away from default
    const zoomOut = screen.getByRole('button', { name: /zoom out/i })
    await user.click(zoomOut)

    // Click Reset
    const reset = screen.getByRole('button', { name: /reset/i })
    await user.click(reset)

    // Scale should be 1.5 after reset
    const scalerDiv = container.querySelector('[style*="scale"]')
    const style = (scalerDiv as HTMLElement)?.style
    expect(style?.transform).toContain('1.5')
  })

  it('Fix 2: zoom-in button can scale beyond 3.0 up to 5.0', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // Click zoom in many times to push past 3.0
    const zoomIn = screen.getByRole('button', { name: /zoom in/i })
    for (let i = 0; i < 20; i++) {
      await user.click(zoomIn)
    }

    // Scale should exceed 3.0 (was previously capped at 3.0)
    const scalerDiv = container.querySelector('[style*="scale"]')
    const style = (scalerDiv as HTMLElement)?.style
    // Parse the scale value from transform like "scale(4.5)" or "scale(5)"
    const match = style?.transform.match(/scale\(([^)]+)\)/)
    const scaleValue = match ? parseFloat(match[1]) : 0
    expect(scaleValue).toBeGreaterThan(3.0)
  })

  // ---------------------------------------------------------------------------
  // Fix: wheel zoom useEffect deps + overflow-hidden
  // ---------------------------------------------------------------------------

  it('wheel zoom works when pipeline is selected after initial mount with no pipeline (Fix A: useEffect deps)', async () => {
    // RED: With [] deps, the wheel listener attaches on mount when
    // containerRef.current is null (component returns early). When the pipeline
    // is later selected the container renders but the listener never re-attaches.
    // Fix: change deps to [activePipelineId] so the effect re-runs on selection.

    // Start with no pipeline — component returns early, containerRef.current is null
    mockActivePipelineId.current = null
    const { rerender } = render(<GraphPane />)
    expect(screen.getByText('Select a pipeline')).toBeInTheDocument()

    // Simulate selecting a pipeline (activePipelineId transitions null → 'pipe-1')
    mockActivePipelineId.current = 'pipe-1'
    rerender(<GraphPane />)

    // Wait for SVG to finish rendering
    await waitFor(() => {
      expect(screen.queryByText('Select a pipeline')).not.toBeInTheDocument()
    })

    // Grab initial scale from the CSS transform scaler div
    const scalerDiv = document.querySelector('[style*="scale"]') as HTMLElement
    expect(scalerDiv).toBeInTheDocument()
    const initialTransform = scalerDiv.style.transform

    // Dispatch a native wheel event (scroll down → zoom out, deltaY > 0)
    const graphContainer = document.querySelector('.bg-gray-900') as HTMLElement
    expect(graphContainer).toBeInTheDocument()
    fireEvent.wheel(graphContainer, { deltaY: 100 })

    // Scale must change — proves the wheel listener was actually attached
    await waitFor(() => {
      expect(scalerDiv.style.transform).not.toBe(initialTransform)
    })
  })

  it('graph container has overflow-hidden class (Fix B: prevents browser claiming wheel events)', async () => {
    // RED: container had overflow-auto which caused the browser to intercept
    // wheel events for native scrolling before any JS handler could act.
    // Fix: change to overflow-hidden (panning is handled by mouse drag).
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    // Must use overflow-hidden, NOT overflow-auto
    expect(container.querySelector('.overflow-hidden')).toBeInTheDocument()
    expect(container.querySelector('.overflow-auto')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // Dual trackpad + mouse input handling
  // ---------------------------------------------------------------------------

  it('trackpad pinch zoom changes scale (ctrlKey+wheel)', async () => {
    // RED: current wheel handler treats all wheel events as discrete zoom.
    // Pinch-to-zoom should use a fine-grained delta (0.01 * deltaY) rather than
    // fixed +/-0.1 steps. After fix: ctrlKey=true → scale changes by -deltaY*0.01.
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement
    const initialTransform = scalerDiv.style.transform

    // Pinch-to-zoom: ctrlKey=true, small negative deltaY (zooming in)
    fireEvent.wheel(graphContainer, { deltaY: -20, ctrlKey: true })

    await waitFor(() => {
      expect(scalerDiv.style.transform).not.toBe(initialTransform)
    })

    // Scale should have increased (deltaY negative → zoom in)
    const match = scalerDiv.style.transform.match(/scale\(([^)]+)\)/)
    const scaleValue = match ? parseFloat(match[1]) : 0
    expect(scaleValue).toBeGreaterThan(1.5)
  })

  it('trackpad two-finger scroll changes pan (small pixel-based deltas)', async () => {
    // RED: current wheel handler always changes scale, never pan.
    // Trackpad two-finger scroll (ctrlKey=false, small deltaX/deltaY) should
    // update pan state, reflected as translate() in the CSS transform.
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement

    // Trackpad scroll: small deltas, no ctrlKey
    fireEvent.wheel(graphContainer, { deltaX: 10, deltaY: 8, ctrlKey: false })

    await waitFor(() => {
      // Transform should now contain translate() with non-zero values
      expect(scalerDiv.style.transform).toMatch(/translate\(/)
    })

    // Should include a non-zero translate (pan moved)
    const transformStr = scalerDiv.style.transform
    expect(transformStr).not.toContain('translate(0px, 0px)')
  })

  it('mouse wheel zoom changes scale (large discrete deltaY)', async () => {
    // RED: after the new handler, large deltaY events (>=50, deltaX=0) must
    // still trigger scale changes (mouse wheel zoom), not pan.
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement
    const initialTransform = scalerDiv.style.transform

    // Mouse wheel: large deltaY, no deltaX, no ctrlKey
    fireEvent.wheel(graphContainer, { deltaY: 120, deltaX: 0, ctrlKey: false })

    await waitFor(() => {
      expect(scalerDiv.style.transform).not.toBe(initialTransform)
    })

    // Scale should have decreased (deltaY > 0 → zoom out)
    const match = scalerDiv.style.transform.match(/scale\(([^)]+)\)/)
    const scaleValue = match ? parseFloat(match[1]) : 0
    expect(scaleValue).toBeLessThan(1.5)
  })

  it('reset button resets both pan and scale to initial state', async () => {
    // RED: current Reset only resets scale; pan state not yet implemented.
    // After fix: Reset should set transform to translate(0px, 0px) scale(1.5).
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement

    // Pan by dispatching a two-finger scroll
    fireEvent.wheel(graphContainer, { deltaX: 50, deltaY: 30, ctrlKey: false })

    await waitFor(() => {
      expect(scalerDiv.style.transform).not.toContain('translate(0px, 0px)')
    })

    // Click Reset
    const reset = screen.getByRole('button', { name: /reset/i })
    await user.click(reset)

    // Both pan and scale should be reset
    await waitFor(() => {
      expect(scalerDiv.style.transform).toContain('translate(0px, 0px)')
      expect(scalerDiv.style.transform).toContain('1.5')
    })
  })

  // ---------------------------------------------------------------------------
  // Cover-fit: initial zoom/pan — cover the available space (portrait/landscape)
  // ---------------------------------------------------------------------------

  it('cover-fit: SVG has explicit pixel dimensions after render (not 100%/100%)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockRenderString.mockReturnValue(
      '<svg width="400pt" height="800pt" viewBox="0 0 400 800"><g id="node1"><title>nodeA</title></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const svgEl = container.querySelector('svg')
      expect(svgEl).toBeInTheDocument()
      // SVG must NOT use 100% dimensions (which make cover-fit unpredictable)
      expect(svgEl?.getAttribute('width')).not.toBe('100%')
      expect(svgEl?.getAttribute('height')).not.toBe('100%')
    })
  })

  // ---------------------------------------------------------------------------
  // Fix 1: Cursor on container + text selection prevention during drag
  // ---------------------------------------------------------------------------

  it('Fix 1: container cursor becomes grabbing on mousedown, grab on mouseup', async () => {
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement

    // Before mousedown: cursor should not be grabbing
    expect(graphContainer.style.cursor).not.toBe('grabbing')

    // Simulate mousedown
    fireEvent.mouseDown(graphContainer, { clientX: 100, clientY: 100 })

    // Container itself should now show grabbing cursor
    expect(graphContainer.style.cursor).toBe('grabbing')

    // Simulate mouseup
    fireEvent.mouseUp(graphContainer)

    // Container should revert to grab
    expect(graphContainer.style.cursor).toBe('grab')
  })

  it('Fix 1: document.body.userSelect is none during drag, cleared on mouseup', async () => {
    mockActivePipelineId.current = 'pipe-1'

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement

    // Before mousedown: userSelect should not be 'none'
    expect(document.body.style.userSelect).not.toBe('none')

    // Simulate mousedown
    fireEvent.mouseDown(graphContainer, { clientX: 100, clientY: 100 })

    // During drag: selection must be prevented
    expect(document.body.style.userSelect).toBe('none')

    // Simulate mouseup
    fireEvent.mouseUp(graphContainer)

    // After mouseup: userSelect should be cleared
    expect(document.body.style.userSelect).toBe('')
  })

  // ---------------------------------------------------------------------------
  // Fix 2: Wheel zoom anchors to mouse cursor position
  // ---------------------------------------------------------------------------

  it('Fix 2: discrete mouse wheel zoom adjusts pan to anchor zoom at cursor position', async () => {
    // Before fix: scale changes but pan stays at 0,0 (zooms from top-left corner).
    // After fix: pan shifts so the point under the cursor stays fixed.
    // With JSDOM getBoundingClientRect returning {left:0, top:0}, mouseX=clientX, mouseY=clientY.
    // At clientX=100, clientY=50, scale 1.5→1.35:
    //   graphX = 100/1.5 = 66.67, graphY = 50/1.5 = 33.33
    //   newPanX = 100 - 66.67*1.35 ≈ 10, newPanY = 50 - 33.33*1.35 ≈ 5
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement

    // Fire a discrete wheel event (large deltaY, no ctrlKey) at a non-zero position
    fireEvent.wheel(graphContainer, {
      deltaY: 120, deltaX: 0, ctrlKey: false, clientX: 100, clientY: 50,
    })

    await waitFor(() => {
      // Pan must shift — not stay at 0,0 — because zoom anchors at cursor position
      expect(scalerDiv.style.transform).not.toContain('translate(0px, 0px)')
    })
  })

  it('Fix 2: pinch-to-zoom (ctrlKey+wheel) adjusts pan to anchor zoom at cursor position', async () => {
    // Same algorithm but via the ctrlKey branch (pinch / Ctrl+scroll).
    // At clientX=100, clientY=50, scale 1.5+0.2=1.7:
    //   graphX = 100/1.5 = 66.67, graphY = 50/1.5 = 33.33
    //   newPanX = 100 - 66.67*1.7 ≈ -13.3, newPanY = 50 - 33.33*1.7 ≈ -6.7
    mockActivePipelineId.current = 'pipe-1'
    const { container } = render(<GraphPane />)

    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    const graphContainer = container.querySelector('.bg-gray-900') as HTMLElement
    const scalerDiv = container.querySelector('[style*="scale"]') as HTMLElement

    // Fire a pinch-zoom event at a non-zero position
    fireEvent.wheel(graphContainer, {
      deltaY: -20, deltaX: 0, ctrlKey: true, clientX: 100, clientY: 50,
    })

    await waitFor(() => {
      // Pan must shift — not stay at 0,0 — because zoom anchors at cursor position
      expect(scalerDiv.style.transform).not.toContain('translate(0px, 0px)')
    })
  })

  it('UI-BUG-021: parallel_branch_started alone colors node yellow (#eab308)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'parallel_branch_started',
            branch: 'FinalReviewOpus',
            index: 0,
          } as PipelineEvent,
        ],
      ],
    ])
    mockRenderString.mockReturnValue(
      '<svg><g id="node1"><title>FinalReviewOpus</title><polygon fill="#ffffff" stroke="black" points="100,100 200,100 200,150 100,150"/><text fill="black">Opus</text></g></svg>',
    )

    const { container } = render(<GraphPane />)

    await waitFor(() => {
      const polygon = container.querySelector('g polygon')
      expect(polygon?.getAttribute('fill')).toBe('#eab308')
    })
  })
})

// ---------------------------------------------------------------------------
// cover-fit pure helpers — tested independently of component/JSDOM layout
// ---------------------------------------------------------------------------

describe('extractSvgDimensions', () => {
  it('returns null for SVG without pt dimensions', () => {
    expect(extractSvgDimensions('<svg width="100%" height="100%">')).toBeNull()
    expect(extractSvgDimensions('<svg>')).toBeNull()
  })

  it('parses width and height in pt and converts to px (1 pt = 1.333 px)', () => {
    const dims = extractSvgDimensions(
      '<svg width="741pt" height="1772pt" viewBox="0.00 0.00 741.00 1772.00">',
    )
    expect(dims).not.toBeNull()
    expect(dims!.widthPx).toBeCloseTo(741 * 1.333, 1)
    expect(dims!.heightPx).toBeCloseTo(1772 * 1.333, 1)
  })

  it('parses decimal pt values (e.g. "62.50pt")', () => {
    const dims = extractSvgDimensions('<svg width="62.50pt" height="476.00pt">')
    expect(dims).not.toBeNull()
    expect(dims!.widthPx).toBeCloseTo(62.5 * 1.333, 1)
    expect(dims!.heightPx).toBeCloseTo(476.0 * 1.333, 1)
  })
})

describe('computeCoverFit', () => {
  it('portrait graph (height/width > container height/width) fills width, aligns top', () => {
    // graph 400×800px in a 600×400 container
    // graphAspect = 2.0, containerAspect = 0.667 → portrait → fill width
    const result = computeCoverFit(400, 800, 600, 400)
    expect(result.scale).toBeCloseTo(600 / 400, 5) // 1.5
    expect(result.pan).toEqual({ x: 0, y: 0 })
  })

  it('landscape graph (height/width < container height/width) fills height, aligns left', () => {
    // graph 800×400px in a 600×400 container
    // graphAspect = 0.5, containerAspect = 0.667 → landscape → fill height
    const result = computeCoverFit(800, 400, 600, 400)
    expect(result.scale).toBeCloseTo(400 / 400, 5) // 1.0
    expect(result.pan).toEqual({ x: 0, y: 0 })
  })

  it('square graph in landscape container: graphAspect(1.0) > containerAspect(0.5) → portrait branch → fills width', () => {
    // graph 500×500px in a 800×400 container
    // graphAspect = 1.0, containerAspect = 400/800 = 0.5
    // 1.0 > 0.5 → portrait branch → fill width → scale = cw/graphW = 800/500 = 1.6
    const result = computeCoverFit(500, 500, 800, 400)
    expect(result.scale).toBeCloseTo(800 / 500, 5) // 1.6
    expect(result.pan).toEqual({ x: 0, y: 0 })
  })

  it('square graph in portrait container: graphAspect(1.0) < containerAspect(2.0) → landscape branch → fills height', () => {
    // graph 500×500px in a 400×800 container
    // graphAspect = 1.0, containerAspect = 800/400 = 2.0
    // 1.0 NOT > 2.0 → landscape branch → fill height → scale = ch/graphH = 800/500 = 1.6
    const result = computeCoverFit(500, 500, 400, 800)
    expect(result.scale).toBeCloseTo(800 / 500, 5) // 1.6
    expect(result.pan).toEqual({ x: 0, y: 0 })
  })
})
