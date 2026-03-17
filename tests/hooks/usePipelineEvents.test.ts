import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { QuestionResponse } from '../../src/api/types'
import { usePipelineStore } from '../../src/store/pipelines'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

// Capture the subscription callbacks so we can fire events in tests
const mockSubscribeCallbacks = vi.hoisted(() => ({
  current: null as {
    onEvent: (event: unknown) => void
    onOpen?: () => void
    onError?: () => void
  } | null,
}))

const mockSubscribeClose = vi.hoisted(() => vi.fn())

vi.mock('../../src/api/sse', () => ({
  subscribeToPipeline: vi.fn((pipelineId: string, callbacks: typeof mockSubscribeCallbacks.current) => {
    mockSubscribeCallbacks.current = callbacks
    return { close: mockSubscribeClose }
  }),
}))

const mockGetQuestions = vi.hoisted(() => vi.fn())

vi.mock('../../src/api/client', () => ({
  getQuestions: mockGetQuestions,
}))

// Import after mocks are set up
import { usePipelineEvents } from '../../src/hooks/usePipelineEvents'

// ---------------------------------------------------------------------------
// Test 1: usePipelineEvents exports a function
// ---------------------------------------------------------------------------

describe('usePipelineEvents', () => {
  it('exports usePipelineEvents as a function', () => {
    expect(typeof usePipelineEvents).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Test 2: usePipelineStatus exports a function
// ---------------------------------------------------------------------------

describe('usePipelineStatus', () => {
  it('exports usePipelineStatus as a function', async () => {
    const module = await import('../../src/hooks/usePipelineStatus')
    expect(typeof module.usePipelineStatus).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Test 3: fetches real questions from API on interview_started
//
// When the SSE stream fires an interview_started event, the hook must call
// getQuestions() and update the store with the real question data (real UUID
// qid, correct question_type, and actual options) — not just the synthetic
// placeholder created by addEvent.
// ---------------------------------------------------------------------------

describe('usePipelineEvents — interview_started', () => {
  beforeEach(() => {
    mockSubscribeCallbacks.current = null
    mockSubscribeClose.mockClear()
    mockGetQuestions.mockClear()

    // Reset store to clean state
    usePipelineStore.setState({
      pipelines: new Map([
        [
          'pipe-1',
          {
            id: 'pipe-1',
            status: 'running',
            started_at: '2024-01-01T00:00:00Z',
            completed_nodes: [],
            current_node: null,
          },
        ],
      ]),
      activePipelineId: 'pipe-1',
      events: new Map(),
      questions: new Map(),
      selectedNodeId: null,
      sseStatus: 'disconnected',
    })
  })

  it('calls getQuestions and replaces synthetic question with real data on interview_started', async () => {
    const realQuestions: QuestionResponse[] = [
      {
        qid: 'real-uuid-abc-123',
        text: 'Do you want to proceed?',
        question_type: 'multi_select',
        options: [
          { key: 'A', label: '[A] Approve' },
          { key: 'R', label: '[R] Reject' },
        ],
        created_at: '2024-01-01T00:00:00Z',
      },
    ]
    mockGetQuestions.mockResolvedValue({ questions: realQuestions })

    renderHook(() => usePipelineEvents('pipe-1'))

    // Fire the interview_started SSE event
    act(() => {
      mockSubscribeCallbacks.current?.onEvent({
        event: 'interview_started',
        question: 'Do you want to proceed?',
        stage: 'approval',
      })
    })

    // The hook must call getQuestions for this pipeline
    await waitFor(() => {
      expect(mockGetQuestions).toHaveBeenCalledWith('pipe-1')
    })

    // The store must end up with the REAL question data (not synthetic auto-approval)
    await waitFor(() => {
      const questions = usePipelineStore.getState().questions.get('pipe-1')
      expect(questions).toBeDefined()
      expect(questions?.[0]?.qid).toBe('real-uuid-abc-123')
      expect(questions?.[0]?.question_type).toBe('multi_select')
    })
  })
})
