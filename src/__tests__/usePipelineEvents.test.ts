import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetQuestions = vi.hoisted(() => vi.fn())
const mockSetQuestions = vi.hoisted(() => vi.fn())
const mockAddEvent = vi.hoisted(() => vi.fn())
const mockClearPipelineEvents = vi.hoisted(() => vi.fn())
const mockSetSseStatus = vi.hoisted(() => vi.fn())
const mockSubscribeToPipeline = vi.hoisted(() =>
  vi.fn().mockReturnValue({ close: vi.fn() }),
)

// Mutable pipelines map for UI-BUG-009 tests.
// Use an object wrapper so we can mutate .current inside tests.
const mockPipelinesRef = vi.hoisted(() => ({
  current: new Map<string, { status: string }>(),
}))

vi.mock('../api/client', () => ({
  getQuestions: mockGetQuestions,
}))

vi.mock('../api/sse', () => ({
  subscribeToPipeline: mockSubscribeToPipeline,
}))

vi.mock('../store/pipelines', () => ({
  usePipelineStore: {
    getState: () => ({
      addEvent: mockAddEvent,
      clearPipelineEvents: mockClearPipelineEvents,
      setSseStatus: mockSetSseStatus,
      setQuestions: mockSetQuestions,
      pipelines: mockPipelinesRef.current,
    }),
  },
}))

import { usePipelineEvents } from '../hooks/usePipelineEvents'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePipelineEvents — question polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockGetQuestions.mockResolvedValue({ questions: [] })
    mockPipelinesRef.current = new Map()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('polls getQuestions every 2 seconds while connected to a pipeline', async () => {
    renderHook(() => usePipelineEvents('pipe-1'))

    // Not called immediately on mount
    expect(mockGetQuestions).not.toHaveBeenCalled()

    // Advance 2 s → first poll fires
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockGetQuestions).toHaveBeenCalledTimes(1)
    expect(mockGetQuestions).toHaveBeenCalledWith('pipe-1')

    // Advance another 2 s → second poll fires
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockGetQuestions).toHaveBeenCalledTimes(2)
  })

  it('does not poll when pipelineId is null', async () => {
    renderHook(() => usePipelineEvents(null))

    await act(async () => {
      vi.advanceTimersByTime(10000)
    })

    expect(mockGetQuestions).not.toHaveBeenCalled()
  })

  it('calls setQuestions with the fetched questions', async () => {
    const fakeQuestions = [
      {
        qid: 'q-1',
        text: 'Continue?',
        question_type: 'confirmation' as const,
        options: [],
        created_at: '2024-01-01T00:00:00Z',
      },
    ]
    mockGetQuestions.mockResolvedValue({ questions: fakeQuestions })

    renderHook(() => usePipelineEvents('pipe-1'))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Wait for the promise to resolve
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockSetQuestions).toHaveBeenCalledWith('pipe-1', fakeQuestions)
  })

  it('does NOT call setQuestions again when questions are unchanged between polls (UI-BUG-005)', async () => {
    const fakeQuestions = [
      {
        qid: 'q-1',
        text: 'Continue?',
        question_type: 'confirmation' as const,
        options: [],
        created_at: '2024-01-01T00:00:00Z',
      },
    ]
    // Every poll returns the SAME question list
    mockGetQuestions.mockResolvedValue({ questions: fakeQuestions })

    renderHook(() => usePipelineEvents('pipe-1'))

    // First poll fires at 2s
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockSetQuestions).toHaveBeenCalledTimes(1)

    // Second poll fires at 4s — same data returned
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      await Promise.resolve()
    })
    // setQuestions must NOT be called again since questions are identical
    expect(mockSetQuestions).toHaveBeenCalledTimes(1)
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-009: poll questions even for cancelled/failed/completed pipelines
  // ---------------------------------------------------------------------------

  it('UI-BUG-009: continues polling questions even when pipeline is cancelled', async () => {
    // Before fix: polling stopped when pipeline.status !== 'running'.
    // After fix: polling always continues regardless of pipeline status.
    //
    // Set up the mock pipelines map to return a cancelled pipeline.
    mockPipelinesRef.current = new Map([['pipe-cancelled', { status: 'cancelled' }]])

    renderHook(() => usePipelineEvents('pipe-cancelled'))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Must still poll even though pipeline is cancelled.
    expect(mockGetQuestions).toHaveBeenCalledTimes(1)
    expect(mockGetQuestions).toHaveBeenCalledWith('pipe-cancelled')
  })

  it('UI-BUG-009: continues polling questions even when pipeline is failed', async () => {
    mockPipelinesRef.current = new Map([['pipe-failed', { status: 'failed' }]])

    renderHook(() => usePipelineEvents('pipe-failed'))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockGetQuestions).toHaveBeenCalledTimes(1)
    expect(mockGetQuestions).toHaveBeenCalledWith('pipe-failed')
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-008: SSE replay cap — limit events processed on initial connect
  // ---------------------------------------------------------------------------

  it('UI-BUG-008: caps events at REPLAY_CAP (1000) during initial connection', async () => {
    // Before fix: every SSE event called addEvent, so 24K+ events flooded the store.
    // After fix: only the first REPLAY_CAP events are forwarded to addEvent,
    // plus at most 1 synthetic "events_capped" notice.

    let capturedOnEvent: ((event: unknown) => void) | null = null

    // Override the subscribe mock to capture the onEvent callback.
    mockSubscribeToPipeline.mockImplementationOnce(
      (_id: string, { onEvent }: { onEvent: (event: unknown) => void }) => {
        capturedOnEvent = onEvent
        return { close: vi.fn() }
      },
    )

    renderHook(() => usePipelineEvents('pipe-flood'))

    // Simulate 1200 events arriving rapidly (replay burst).
    act(() => {
      for (let i = 0; i < 1200; i++) {
        capturedOnEvent!({ event: 'stage_started', name: `task-${i}`, index: i })
      }
    })

    // addEvent must be called at most REPLAY_CAP + 1 times (the +1 is for the
    // optional synthetic "events_capped" notice emitted at the boundary).
    expect(mockAddEvent.mock.calls.length).toBeLessThanOrEqual(1001)

    // addEvent must be called at least REPLAY_CAP times (we did process events).
    expect(mockAddEvent.mock.calls.length).toBeGreaterThanOrEqual(1000)
  })

  it('UI-BUG-008: does not cap when fewer than REPLAY_CAP events arrive', async () => {
    let capturedOnEvent: ((event: unknown) => void) | null = null

    mockSubscribeToPipeline.mockImplementationOnce(
      (_id: string, { onEvent }: { onEvent: (event: unknown) => void }) => {
        capturedOnEvent = onEvent
        return { close: vi.fn() }
      },
    )

    renderHook(() => usePipelineEvents('pipe-small'))

    // Simulate only 50 events — well under the cap.
    act(() => {
      for (let i = 0; i < 50; i++) {
        capturedOnEvent!({ event: 'stage_started', name: `task-${i}`, index: i })
      }
    })

    // All 50 events must be forwarded.
    expect(mockAddEvent).toHaveBeenCalledTimes(50)
  })

  it('clears the poll interval when pipelineId becomes null', async () => {
    const { rerender } = renderHook(
      ({ id }: { id: string | null }) => usePipelineEvents(id),
      { initialProps: { id: 'pipe-1' as string | null } },
    )

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockGetQuestions).toHaveBeenCalledTimes(1)

    // Switch to null
    rerender({ id: null })

    // Advance more time — no more calls
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    expect(mockGetQuestions).toHaveBeenCalledTimes(1)
  })
})
