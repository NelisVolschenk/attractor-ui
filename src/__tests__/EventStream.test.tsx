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
const mockSelectNodeWithInstance = vi.hoisted(() => vi.fn())
const mockSseStatus = vi.hoisted(
  () => ({ current: 'connected' as 'connected' | 'reconnecting' | 'disconnected' }),
)
import type { QuestionResponse, PipelineSummary } from '../api/types'
const mockQuestions = vi.hoisted(() => ({ current: new Map<string, QuestionResponse[]>() }))
const mockPipelines = vi.hoisted(() => ({ current: new Map<string, PipelineSummary>() }))

vi.mock('../store/pipelines', () => ({
  usePipelineStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      activePipelineId: mockActivePipelineId.current,
      events: mockEvents.current,
      selectNode: mockSelectNode,
      selectNodeWithInstance: mockSelectNodeWithInstance,
      sseStatus: mockSseStatus.current,
      questions: mockQuestions.current,
      pipelines: mockPipelines.current,
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
    mockSelectNodeWithInstance.mockClear()
    mockSseStatus.current = 'connected'
    mockQuestions.current = new Map()
    mockPipelines.current = new Map()
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

    // Task 3a: node name first, then short label. Task 3b: collapsed mode
    // merges start+complete into one row showing the latest label.
    expect(screen.getByText('fetch-data')).toBeInTheDocument()
    // Short label for stage_completed: "completed (0.1s)"
    expect(screen.getByText(/— completed \(0\.1s\)/)).toBeInTheDocument()
    // Raw event names must NOT appear (we now show short labels)
    expect(screen.queryByText('stage_started')).not.toBeInTheDocument()
    expect(screen.queryByText('stage_completed')).not.toBeInTheDocument()
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

  it('calls selectNodeWithInstance when an event row is clicked', async () => {
    // Task 4b: clicking an event row calls selectNodeWithInstance (not selectNode)
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

    // In collapsed mode, look for the node name and click its row
    const nodeNameEl = screen.getByText('process-data')
    const eventRow = nodeNameEl.closest('li')
    expect(eventRow).toBeInTheDocument()
    await user.click(eventRow!)

    // Collapsed mode calls selectNodeWithInstance(nodeName, passNumber)
    expect(mockSelectNodeWithInstance).toHaveBeenCalledTimes(1)
    expect(mockSelectNodeWithInstance).toHaveBeenCalledWith('process-data', 1)
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

  // ---------------------------------------------------------------------------
  // UI-FEAT-013: LLM progress indicators
  // ---------------------------------------------------------------------------

  it('UI-FEAT-013: running stage shows animate-pulse indicator', () => {
    // RED: current code has no pulsing indicator for running stages
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'ExploreIdea', index: 0 } as PipelineEvent,
          // No stage_completed — still running
        ],
      ],
    ])

    const { container } = render(<EventStream />)

    // A running stage should show a pulsing indicator element
    const pulsingEl = container.querySelector('.animate-pulse')
    expect(pulsingEl).toBeInTheDocument()
  })

  it('UI-FEAT-013: completed stage does NOT show animate-pulse', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'ExploreIdea', index: 0 } as PipelineEvent,
          {
            event: 'stage_completed',
            name: 'ExploreIdea',
            index: 0,
            duration: { __duration_ms: 3000 },
          } as PipelineEvent,
        ],
      ],
    ])

    const { container } = render(<EventStream />)

    // Completed stage — no pulsing indicator
    const pulsingEl = container.querySelector('.animate-pulse')
    expect(pulsingEl).not.toBeInTheDocument()
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
  // UI-BUG-015: Show "Waiting for human input" on human gate stages
  // ---------------------------------------------------------------------------

  it('UI-BUG-015: running stage shows "Waiting for human input..." when questions are pending', () => {
    // When a stage is running AND there are pending questions for the pipeline
    // (i.e. a human gate is active), the progress label should say
    // "Waiting for human input..." rather than "LLM call in progress..."
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'BrainstormWithHuman', index: 0 } as PipelineEvent,
        ],
      ],
    ])
    mockQuestions.current = new Map([
      [
        'pipe-1',
        [
          {
            qid: 'q-1',
            text: 'What should we build?',
            question_type: 'free_text' as const,
            options: [],
            created_at: new Date().toISOString(),
          },
        ],
      ],
    ])

    render(<EventStream />)

    expect(screen.getByText('Waiting for human input...')).toBeInTheDocument()
    expect(screen.queryByText('LLM call in progress...')).not.toBeInTheDocument()
  })

  it('UI-BUG-015: running stage still shows pulsing indicator when questions are pending', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'BrainstormWithHuman', index: 0 } as PipelineEvent,
        ],
      ],
    ])
    mockQuestions.current = new Map([
      [
        'pipe-1',
        [
          {
            qid: 'q-1',
            text: 'What should we build?',
            question_type: 'free_text' as const,
            options: [],
            created_at: new Date().toISOString(),
          },
        ],
      ],
    ])

    const { container } = render(<EventStream />)

    // Pulsing indicator should still be present for the running stage
    const pulsingEl = container.querySelector('.animate-pulse')
    expect(pulsingEl).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-018: Cancel stops pulsing indicator in EventStream
  // ---------------------------------------------------------------------------

  it('UI-BUG-018: cancelled pipeline does NOT show pulsing indicator even if last event was stage_started', () => {
    // When a pipeline is cancelled while a stage is running, the stage_started
    // event remains in the event log. EventStream should NOT show the pulsing
    // "LLM running" indicator once the pipeline status is terminal.
    mockActivePipelineId.current = 'pipe-1'
    mockEvents.current = new Map([
      [
        'pipe-1',
        [
          { event: 'stage_started', name: 'DraftPlan', index: 0 } as PipelineEvent,
          // No stage_completed — the stage was interrupted by cancel
        ],
      ],
    ])
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

    const { container } = render(<EventStream />)

    // Pipeline is cancelled — no pulsing indicator
    const pulsingEl = container.querySelector('.animate-pulse')
    expect(pulsingEl).not.toBeInTheDocument()
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
