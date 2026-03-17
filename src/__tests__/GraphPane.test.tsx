import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineEvent } from '../api/types'

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
      expect(mockRenderString).toHaveBeenCalledWith(
        'digraph { a -> b }',
        { format: 'svg' },
      )
    })
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
})
