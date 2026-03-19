import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import type { PipelineSummary } from '../api/types'

// ---------------------------------------------------------------------------
// Hoisted store mock state — must be before vi.mock()
// ---------------------------------------------------------------------------

const mockActivePipelineId = vi.hoisted(() => ({ current: null as string | null }))
const mockPipelines = vi.hoisted(() => ({ current: new Map<string, PipelineSummary>() }))

vi.mock('../store/pipelines', () => ({
  usePipelineStore: () => ({
    activePipelineId: mockActivePipelineId.current,
    pipelines: mockPipelines.current,
  }),
}))

// ---------------------------------------------------------------------------
// Mock react-resizable-panels — jsdom lacks ResizeObserver
// Capture props so tests can verify defaultSize, onLayoutChanged, etc.
// ---------------------------------------------------------------------------

interface CapturedGroupProps {
  defaultLayout?: Record<string, number>
  onLayoutChanged?: (layout: Record<string, number>) => void
  id?: string
  [key: string]: unknown
}

const capturedGroups: CapturedGroupProps[] = []
const capturedPanelSizes: (number | string | undefined)[] = []

vi.mock('react-resizable-panels', () => ({
  Group: ({ children, defaultLayout, onLayoutChanged, id, ...rest }: CapturedGroupProps) => {
    capturedGroups.push({ defaultLayout, onLayoutChanged, id, ...rest })
    return <div data-testid="panel-group">{children}</div>
  },
  Panel: ({ children, defaultSize }: { children: React.ReactNode; defaultSize?: number | string }) => {
    capturedPanelSizes.push(defaultSize)
    return <div data-testid="panel">{children}</div>
  },
  Separator: () => <div data-testid="resize-handle" />,
}))

// ---------------------------------------------------------------------------
// Mock the 4 child components
// ---------------------------------------------------------------------------

vi.mock('../components/GraphPane', () => ({
  GraphPane: () => <div data-testid="graph-pane">GraphPane</div>,
}))

vi.mock('../components/EventStream', () => ({
  EventStream: () => <div data-testid="event-stream">EventStream</div>,
}))

vi.mock('../components/NodeDetails', () => ({
  NodeDetails: () => <div data-testid="node-details">NodeDetails</div>,
}))

vi.mock('../components/HumanInteraction', () => ({
  HumanInteraction: () => <div data-testid="human-interaction">HumanInteraction</div>,
}))

// Import after mocks are set up
import { Dashboard } from '../components/Dashboard'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {
  beforeEach(() => {
    capturedGroups.length = 0
    capturedPanelSizes.length = 0
    localStorage.clear()
    mockActivePipelineId.current = null
    mockPipelines.current = new Map()
  })

  it('renders all four pane components', () => {
    render(<Dashboard />)
    expect(screen.getByTestId('graph-pane')).toBeInTheDocument()
    expect(screen.getByTestId('event-stream')).toBeInTheDocument()
    expect(screen.getByTestId('node-details')).toBeInTheDocument()
    expect(screen.getByTestId('human-interaction')).toBeInTheDocument()
  })

  it('has at least 3 resize handles', () => {
    render(<Dashboard />)
    const handles = screen.getAllByTestId('resize-handle')
    expect(handles.length).toBeGreaterThanOrEqual(3)
  })

  it('defaults to 80/20 vertical split (top 80%, bottom 20%)', () => {
    render(<Dashboard />)
    // Panel sizes: [top-left, top-right, bottom-left, bottom-right]
    // OR if vertical panels come first: [top-row, bottom-row, top-left, top-right, bottom-left, bottom-right]
    // The outer Group's two Panels should have defaultSize 80 and 20
    const sizes = capturedPanelSizes.filter((s) => s !== undefined)
    expect(sizes).toContain(80)
    expect(sizes).toContain(20)
  })

  it('passes onLayoutChanged to each Group for localStorage persistence', () => {
    render(<Dashboard />)
    const groupsWithCallback = capturedGroups.filter((g) => typeof g.onLayoutChanged === 'function')
    expect(groupsWithCallback.length).toBeGreaterThanOrEqual(1)
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-016: Terminal state banner on cancel/complete/fail
  // ---------------------------------------------------------------------------

  it('UI-BUG-016: shows cancelled banner when active pipeline is cancelled', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'cancelled',
          started_at: new Date().toISOString(),
          completed_nodes: [],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    expect(screen.getByText(/pipeline cancelled/i)).toBeInTheDocument()
  })

  it('UI-BUG-016: shows completed banner when active pipeline is completed', () => {
    mockActivePipelineId.current = 'pipe-2'
    mockPipelines.current = new Map([
      [
        'pipe-2',
        {
          id: 'pipe-2',
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_nodes: ['nodeA'],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    expect(screen.getByText(/pipeline completed/i)).toBeInTheDocument()
  })

  it('UI-BUG-016: shows failed banner when active pipeline is failed', () => {
    mockActivePipelineId.current = 'pipe-3'
    mockPipelines.current = new Map([
      [
        'pipe-3',
        {
          id: 'pipe-3',
          status: 'failed',
          started_at: new Date().toISOString(),
          completed_nodes: [],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    expect(screen.getByText(/pipeline failed/i)).toBeInTheDocument()
  })

  it('UI-BUG-016: does NOT show terminal banner when pipeline is running', () => {
    mockActivePipelineId.current = 'pipe-4'
    mockPipelines.current = new Map([
      [
        'pipe-4',
        {
          id: 'pipe-4',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: [],
          current_node: 'nodeA',
        },
      ],
    ])

    render(<Dashboard />)

    // No terminal banner for running pipelines
    expect(screen.queryByText(/pipeline cancelled/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/pipeline completed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/pipeline failed/i)).not.toBeInTheDocument()
  })

  it('saves layout to localStorage when onLayoutChanged fires', () => {
    render(<Dashboard />)
    const firstGroup = capturedGroups.find((g) => typeof g.onLayoutChanged === 'function')
    expect(firstGroup).toBeDefined()

    // Simulate a layout change
    firstGroup!.onLayoutChanged!({ 'top': 70, 'bottom': 30 })

    // Something should now be saved to localStorage
    let found = false
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('attractor-panels')) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-022: Terminal banner blocks controls
  // ---------------------------------------------------------------------------

  it('UI-BUG-022: terminal banner has a dismiss button', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_nodes: ['nodeA'],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    // Banner should be visible
    expect(screen.getByText(/pipeline completed/i)).toBeInTheDocument()
    // Should have a dismiss/close button
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })

  it('UI-BUG-022: clicking dismiss button hides the banner', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-2'
    mockPipelines.current = new Map([
      [
        'pipe-2',
        {
          id: 'pipe-2',
          status: 'completed',
          started_at: new Date().toISOString(),
          completed_nodes: ['nodeA'],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    // Banner initially visible
    expect(screen.getByText(/pipeline completed/i)).toBeInTheDocument()

    // Click dismiss
    await user.click(screen.getByRole('button', { name: /dismiss/i }))

    // Banner should be gone
    expect(screen.queryByText(/pipeline completed/i)).not.toBeInTheDocument()
  })

  it('UI-BUG-022: banner container has pointer-events-none, children have pointer-events-auto', () => {
    mockActivePipelineId.current = 'pipe-3'
    mockPipelines.current = new Map([
      [
        'pipe-3',
        {
          id: 'pipe-3',
          status: 'failed',
          started_at: new Date().toISOString(),
          completed_nodes: [],
          current_node: null,
        },
      ],
    ])

    render(<Dashboard />)

    // The banner container should have pointer-events-none so clicks pass
    // through to controls underneath
    const banner = screen.getByText(/pipeline failed/i).closest('[aria-live]')
    expect(banner).toBeInTheDocument()
    expect(banner?.className).toContain('pointer-events-none')

    // The text and dismiss button should have pointer-events-auto so they
    // remain clickable despite the container being click-through
    const textSpan = screen.getByText(/pipeline failed/i)
    expect(textSpan.className).toContain('pointer-events-auto')
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    expect(dismissBtn.className).toContain('pointer-events-auto')
  })
})
