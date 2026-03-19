import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock functions so they're available in vi.mock factory
const mockSetActivePipeline = vi.hoisted(() => vi.fn())
const mockSetPipelineStatus = vi.hoisted(() => vi.fn())
const mockCancelPipeline = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 'cancelled' }))

// Mock the hooks so they don't run real polling/SSE
vi.mock('../hooks/usePipelineStatus', () => ({
  usePipelineStatus: vi.fn(),
}))

vi.mock('../hooks/usePipelineEvents', () => ({
  usePipelineEvents: vi.fn(),
}))

// Mock NewPipelineDialog to a simple stub
vi.mock('../components/NewPipelineDialog', () => ({
  NewPipelineDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="new-pipeline-dialog"><button onClick={onClose}>Close Dialog</button></div> : null,
}))

// Mock the API client
vi.mock('../api/client', () => ({
  cancelPipeline: mockCancelPipeline,
}))

// Default store mock — pipelines is empty by default
const mockStoreState = vi.hoisted(() => ({
  pipelines: new Map(),
  activePipelineId: null as string | null,
  setActivePipeline: mockSetActivePipeline,
  setPipelineStatus: mockSetPipelineStatus,
  questions: new Map() as Map<string, Array<{ qid: string; text: string; question_type: string; options: Array<{ key: string; label: string }>; created_at: string }>>,
}))

vi.mock('../store/pipelines', () => ({
  usePipelineStore: (selector?: (state: typeof mockStoreState) => unknown) => {
    if (selector) return selector(mockStoreState)
    return mockStoreState
  },
}))

import { Sidebar } from '../components/Sidebar'

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreState.pipelines = new Map()
    mockStoreState.activePipelineId = null
    mockStoreState.questions = new Map()
  })

  it('renders the New Pipeline button (title removed in demo polish)', () => {
    render(<Sidebar />)
    // Task 5: "Attractor" title has been removed for the demo
    expect(screen.queryByText('Attractor')).not.toBeInTheDocument()
    expect(screen.getByText('+ New Pipeline')).toBeInTheDocument()
  })

  it('shows empty state when no pipelines exist', () => {
    render(<Sidebar />)
    expect(screen.getByText('No pipelines yet.')).toBeInTheDocument()
  })

  it('renders pipeline entries from store', () => {
    // IDs chosen so their 12-char truncation is unambiguous
    mockStoreState.pipelines = new Map([
      ['abcdefghijklmnop', {
        id: 'abcdefghijklmnop',
        status: 'running' as const,
        started_at: '2024-01-01T10:00:00Z',
        completed_nodes: [],
        current_node: 'build',
      }],
      ['xyz123456789abcd', {
        id: 'xyz123456789abcd',
        status: 'completed' as const,
        started_at: '2024-01-01T09:00:00Z',
        completed_nodes: ['build'],
        current_node: null,
      }],
    ])
    render(<Sidebar />)
    // IDs truncated to 12 chars: 'abcdefghijkl' and 'xyz123456789'
    expect(screen.getByText('abcdefghijkl')).toBeInTheDocument()
    expect(screen.getByText('xyz123456789')).toBeInTheDocument()
    // current_node shown for running pipeline
    expect(screen.getByText('build')).toBeInTheDocument()
  })

  it('calls setActivePipeline when a pipeline entry is clicked', async () => {
    const user = userEvent.setup()
    mockStoreState.pipelines = new Map([
      ['pipeline-id-1234', {
        id: 'pipeline-id-1234',
        status: 'running' as const,
        started_at: '2024-01-01T10:00:00Z',
        completed_nodes: [],
        current_node: null,
      }],
    ])
    render(<Sidebar />)
    // 'pipeline-id-1234'.slice(0, 12) === 'pipeline-id-'
    // Pipeline item is now a <div role="button">, not a <button>
    const item = screen.getByText('pipeline-id-').closest('[role="button"]')!
    await user.click(item)
    expect(mockSetActivePipeline).toHaveBeenCalledWith('pipeline-id-1234')
  })

  it('opens NewPipelineDialog when "+ New Pipeline" is clicked', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    expect(screen.queryByTestId('new-pipeline-dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /\+ New Pipeline/i }))
    expect(screen.getByTestId('new-pipeline-dialog')).toBeInTheDocument()
  })

  it('shows cancel button only for running pipelines', () => {
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
      ['completed-pipeline', { id: 'completed-pipeline', status: 'completed' as const, started_at: '2024-01-03T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    // 'running-pipeline-1'.slice(0, 12) === 'running-pipe'
    const runningItem = screen.getByText('running-pipe').closest('li')!
    expect(runningItem.querySelector('[aria-label="Cancel pipeline"]')).toBeInTheDocument()

    // 'completed-pipeline'.slice(0, 12) === 'completed-pi'
    const completedItem = screen.getByText('completed-pi').closest('li')!
    expect(completedItem.querySelector('[aria-label="Cancel pipeline"]')).not.toBeInTheDocument()
  })

  it('shows a confirmation prompt when cancel button is clicked (UI-FEAT-006)', async () => {
    const user = userEvent.setup()
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    const cancelBtn = screen.getByLabelText('Cancel pipeline')
    await user.click(cancelBtn)

    // First click should NOT call cancelPipeline — it shows a confirmation
    expect(mockCancelPipeline).not.toHaveBeenCalled()

    // Confirmation prompt should be visible
    expect(screen.getByText(/cancel this pipeline\?/i)).toBeInTheDocument()
  })

  it('calls cancelPipeline and setPipelineStatus when cancel is confirmed (UI-FEAT-006)', async () => {
    const user = userEvent.setup()
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    // Open confirmation
    await user.click(screen.getByLabelText('Cancel pipeline'))

    // Confirm by clicking the Yes button
    await user.click(screen.getByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(mockCancelPipeline).toHaveBeenCalledWith('running-pipeline-1')
      expect(mockSetPipelineStatus).toHaveBeenCalledWith('running-pipeline-1', 'cancelled')
    })
  })

  it('does not call cancelPipeline when cancel confirmation is dismissed (UI-FEAT-006)', async () => {
    const user = userEvent.setup()
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    // Open confirmation
    await user.click(screen.getByLabelText('Cancel pipeline'))

    // Dismiss by clicking No
    await user.click(screen.getByRole('button', { name: /^no$/i }))

    expect(mockCancelPipeline).not.toHaveBeenCalled()

    // Confirmation prompt should be gone
    expect(screen.queryByText(/cancel this pipeline\?/i)).not.toBeInTheDocument()
  })

  it('cancel button is not nested inside another button (UI-BUG-010)', () => {
    // Invalid HTML: a <button> inside a <button>. Fix: outer item must be a <div>.
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    const cancelBtn = screen.getByLabelText('Cancel pipeline')
    // The cancel button should NOT have a <button> ancestor (other than itself)
    const buttonAncestor = cancelBtn.parentElement?.closest('button')
    expect(buttonAncestor).toBeNull()
  })

  it('shows status dots with appropriate colors for each status', () => {
    mockStoreState.pipelines = new Map([
      // running-pipe (12 chars from 'running-pipeline-1')
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
      // completed-pi (12 chars from 'completed-pipeline')
      ['completed-pipeline', { id: 'completed-pipeline', status: 'completed' as const, started_at: '2024-01-03T10:00:00Z', completed_nodes: [], current_node: null }],
      // failed-pipel (12 chars from 'failed-pipeline-xx')
      ['failed-pipeline-xx', { id: 'failed-pipeline-xx', status: 'failed' as const, started_at: '2024-01-02T10:00:00Z', completed_nodes: [], current_node: null }],
      // cancelled-pi (12 chars from 'cancelled-pipelin')
      ['cancelled-pipelin', { id: 'cancelled-pipelin', status: 'cancelled' as const, started_at: '2024-01-01T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    // Each pipeline item is a <div role="button">, not a <button> (UI-BUG-010 fix)
    // 'running-pipeline-1'.slice(0, 12) === 'running-pipe'
    const runningEntry = screen.getByText('running-pipe').closest('[role="button"]')!
    // 'completed-pipeline'.slice(0, 12) === 'completed-pi'
    const completedEntry = screen.getByText('completed-pi').closest('[role="button"]')!
    // 'failed-pipeline-xx'.slice(0, 12) === 'failed-pipel'
    const failedEntry = screen.getByText('failed-pipel').closest('[role="button"]')!
    // 'cancelled-pipelin'.slice(0, 12) === 'cancelled-pi'
    const cancelledEntry = screen.getByText('cancelled-pi').closest('[role="button"]')!

    expect(runningEntry.querySelector('.bg-yellow-400')).toBeInTheDocument()
    expect(completedEntry.querySelector('.bg-green-400')).toBeInTheDocument()
    expect(failedEntry.querySelector('.bg-red-400')).toBeInTheDocument()
    expect(cancelledEntry.querySelector('.bg-gray-400')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-019: sidebar shows "waiting" for running pipelines with questions
  // ---------------------------------------------------------------------------

  it('shows "waiting" status for running pipelines with pending questions (UI-BUG-019)', () => {
    mockStoreState.pipelines = new Map([
      ['waiting-pipeline-1', {
        id: 'waiting-pipeline-1',
        status: 'running' as const,
        started_at: '2024-01-04T10:00:00Z',
        completed_nodes: [],
        current_node: 'ReviewDesign',
      }],
    ])
    // Pipeline has a pending question
    mockStoreState.questions = new Map([
      ['waiting-pipeline-1', [{
        qid: 'q-1',
        text: 'Approve the design?',
        question_type: 'confirmation',
        options: [],
        created_at: '2024-01-04T10:01:00Z',
      }]],
    ])
    render(<Sidebar />)

    // 'waiting-pipeline-1'.slice(0, 12) === 'waiting-pipe'
    const entry = screen.getByText('waiting-pipe').closest('[role="button"]')!
    // Status text should say "waiting", not "running"
    expect(screen.getByText('waiting')).toBeInTheDocument()
    // Dot should be blue (waiting), not yellow (running)
    expect(entry.querySelector('.bg-blue-400')).toBeInTheDocument()
    expect(entry.querySelector('.bg-yellow-400')).toBeNull()
  })

  it('shows "running" status when pipeline has no pending questions (UI-BUG-019)', () => {
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', {
        id: 'running-pipeline-1',
        status: 'running' as const,
        started_at: '2024-01-04T10:00:00Z',
        completed_nodes: [],
        current_node: 'Build',
      }],
    ])
    // No questions
    mockStoreState.questions = new Map()
    render(<Sidebar />)

    // 'running-pipeline-1'.slice(0, 12) === 'running-pipe'
    const entry = screen.getByText('running-pipe').closest('[role="button"]')!
    // Status should be "running" with yellow dot
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(entry.querySelector('.bg-yellow-400')).toBeInTheDocument()
  })

  it('shows cancel button for "waiting" pipelines (UI-BUG-019)', () => {
    // A "waiting" pipeline still has server status "running", so the cancel
    // button must remain visible.
    mockStoreState.pipelines = new Map([
      ['waiting-pipeline-1', {
        id: 'waiting-pipeline-1',
        status: 'running' as const,
        started_at: '2024-01-04T10:00:00Z',
        completed_nodes: [],
        current_node: 'ReviewDesign',
      }],
    ])
    mockStoreState.questions = new Map([
      ['waiting-pipeline-1', [{
        qid: 'q-1',
        text: 'Approve?',
        question_type: 'confirmation',
        options: [],
        created_at: '2024-01-04T10:01:00Z',
      }]],
    ])
    render(<Sidebar />)

    // 'waiting-pipeline-1'.slice(0, 12) === 'waiting-pipe'
    const entry = screen.getByText('waiting-pipe').closest('li')!
    // Cancel button must be present (underlying status is still 'running')
    expect(entry.querySelector('[aria-label="Cancel pipeline"]')).toBeInTheDocument()
  })

  it('reverts from "waiting" to "running" when questions are answered (UI-BUG-019)', () => {
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', {
        id: 'running-pipeline-1',
        status: 'running' as const,
        started_at: '2024-01-04T10:00:00Z',
        completed_nodes: [],
        current_node: 'Build',
      }],
    ])
    // Questions are empty (answered)
    mockStoreState.questions = new Map([
      ['running-pipeline-1', []],
    ])
    render(<Sidebar />)

    const entry = screen.getByText('running-pipe').closest('[role="button"]')!
    // Empty questions array = still "running", not "waiting"
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(entry.querySelector('.bg-yellow-400')).toBeInTheDocument()
  })
})
