import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import type { PipelineEvent } from '../api/types'

// ---------------------------------------------------------------------------
// react-virtuoso mock
//
// react-virtuoso renders nothing in jsdom because it relies on
// ResizeObserver callbacks to determine the visible viewport, and jsdom
// elements have zero dimensions by default.
//
// For component tests we replace Virtuoso with a plain renderer that passes
// all items through.  This keeps all existing assertions working while still
// letting the test file import the real EventStream implementation (which
// uses the real Virtuoso in production).
//
// The mock preserves:
//   • data-virtuoso-scroller attribute — lets the structural test verify the
//     component uses the virtualised path.
//   • All list items in the DOM — so content / click assertions continue to
//     pass.
// ---------------------------------------------------------------------------
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data = [],
    itemContent,
    className,
    style,
    followOutput: _followOutput,
    atBottomStateChange: _atBottom,
    defaultItemHeight: _dih,
  }: {
    data?: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
    className?: string
    style?: React.CSSProperties
    followOutput?: unknown
    atBottomStateChange?: unknown
    defaultItemHeight?: number
  }) => (
    <div
      data-virtuoso-scroller="true"
      className={className}
      style={style}
    >
      <ul>
        {data.map((item, i) => (
          <React.Fragment key={i}>{itemContent(i, item)}</React.Fragment>
        ))}
      </ul>
    </div>
  ),
}))

// Hoisted mutable mock state - must be defined before vi.mock()
const mockActivePipelineId = vi.hoisted(() => ({ current: null as string | null }))
const mockEvents = vi.hoisted(() => ({ current: new Map<string, PipelineEvent[]>() }))
const mockSelectNode = vi.hoisted(() => vi.fn())
const mockSseStatus = vi.hoisted(
  () => ({ current: 'connected' as 'connected' | 'reconnecting' | 'disconnected' }),
)

vi.mock('../store/pipelines', () => ({
  usePipelineStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      activePipelineId: mockActivePipelineId.current,
      events: mockEvents.current,
      selectNode: mockSelectNode,
      sseStatus: mockSseStatus.current,
    }
    if (selector) return selector(state)
    return state
  },
}))

import { EventStream } from '../components/EventStream'

describe('EventStream', () => {
  beforeEach(() => {
    mockActivePipelineId.current = null
    mockEvents.current = new Map()
    mockSelectNode.mockClear()
    mockSseStatus.current = 'connected'
  })

  it('shows empty state when no events', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([['pipe-1', []]])

    render(<EventStream />)

    expect(screen.getByText('No events yet.')).toBeInTheDocument()
  })

  it('renders event entries from the store', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'fetch-data', index: 0 } as PipelineEvent,
          { event: 'stage_completed', name: 'fetch-data', index: 0, duration: { __duration_ms: 100 } } as PipelineEvent,
        ],
      ],
    ])

    render(<EventStream />)

    expect(screen.getByText('stage_started')).toBeInTheDocument()
    expect(screen.getByText('stage_completed')).toBeInTheDocument()
    expect(screen.getAllByText('fetch-data')).toHaveLength(2)
  })

  it('applies green class for node_completed (stage_completed) events', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'stage_completed',
            name: 'my-node',
            index: 0,
            duration: { __duration_ms: 50 },
          } as PipelineEvent,
        ],
      ],
    ])

    const { container } = render(<EventStream />)

    // The icon span for a completed event should have the green color class
    const greenIcon = container.querySelector('.text-green-400')
    expect(greenIcon).toBeInTheDocument()
  })

  it('applies red class for pipeline_failed events', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          {
            event: 'pipeline_failed',
            error: 'something went wrong',
            duration: { __duration_ms: 200 },
          } as PipelineEvent,
        ],
      ],
    ])

    const { container } = render(<EventStream />)

    // The icon span for a failed event should have the red color class
    const redIcon = container.querySelector('.text-red-400')
    expect(redIcon).toBeInTheDocument()
  })

  it('calls selectNode when an event row is clicked', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'process-data', index: 0 } as PipelineEvent,
        ],
      ],
    ])

    render(<EventStream />)

    const eventRow = screen.getByText('stage_started').closest('li')
    expect(eventRow).toBeInTheDocument()
    await user.click(eventRow!)

    expect(mockSelectNode).toHaveBeenCalledTimes(1)
    expect(mockSelectNode).toHaveBeenCalledWith('process-data')
  })

  it('shows warning banner when sseStatus is reconnecting', () => {
    mockSseStatus.current = 'reconnecting'
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([['pipe-1', []]])

    render(<EventStream />)

    expect(screen.getByText('Connection lost. Reconnecting...')).toBeInTheDocument()
  })

  it('shows error banner when sseStatus is disconnected and activePipelineId exists', () => {
    mockSseStatus.current = 'disconnected'
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([['pipe-1', []]])

    render(<EventStream />)

    expect(
      screen.getByText('Disconnected from server. Events may be stale.'),
    ).toBeInTheDocument()
  })

  it('does not show disconnected error banner when no activePipelineId', () => {
    mockSseStatus.current = 'disconnected'
    mockActivePipelineId.current = null
    mockEvents.current = new Map()

    render(<EventStream />)

    expect(
      screen.queryByText('Disconnected from server. Events may be stale.'),
    ).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-007: EventStream virtualization
  // ---------------------------------------------------------------------------

  it('UI-BUG-007: uses a virtualized list (data-virtuoso-scroller present) for event rendering', () => {
    // RED: before virtualization, EventStream renders a plain <ul> — no Virtuoso scroller.
    // GREEN: after virtualization, Virtuoso (or the mock) renders a scroll container
    //        with data-virtuoso-scroller="true".
    mockActivePipelineId.current = 'pipe-v'
    mockEvents.current = new Map([
      [
        'pipe-v',
        [{ event: 'stage_started', name: 'task-0', index: 0 } as PipelineEvent],
      ],
    ])

    const { container } = render(<EventStream />)

    // Virtuoso (real or mocked) injects a scroller element with this attribute.
    const scroller = container.querySelector('[data-virtuoso-scroller="true"]')
    expect(scroller).toBeInTheDocument()
  })

  it('UI-BUG-007: renders without hanging given 10,000 events and shows correct count', () => {
    // Generates 10K mock events and verifies:
    //   1. The component renders successfully (no crash/hang).
    //   2. The event count badge shows "10000".
    //   3. Virtuoso (mocked here as a flat renderer) is the rendering path.
    //
    // In a real browser the Virtuoso scroller only renders visible items
    // (~16 at 36 px each in a 600 px viewport) — this is the property that
    // prevents browser lock-up.  The mock makes the test fast in jsdom while
    // the data-virtuoso-scroller assertion proves the real code path is wired.
    mockActivePipelineId.current = 'pipe-big'

    const bigEvents: PipelineEvent[] = Array.from({ length: 10_000 }, (_, i) => ({
      event: 'stage_started',
      name: `task-${i}`,
      index: i,
    } as PipelineEvent))

    mockEvents.current = new Map([['pipe-big', bigEvents]])

    const { container } = render(<EventStream />)

    // Count badge must reflect total event count.
    expect(screen.getByText('10000')).toBeInTheDocument()

    // The Virtuoso scroller path must be used.
    const scroller = container.querySelector('[data-virtuoso-scroller="true"]')
    expect(scroller).toBeInTheDocument()
  })
})
