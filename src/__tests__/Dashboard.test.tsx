import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

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
})
