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
  })

  it('renders the Attractor header', () => {
    render(<Sidebar />)
    expect(screen.getByText('Attractor')).toBeInTheDocument()
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
    const button = screen.getByText('pipeline-id-').closest('button')!
    await user.click(button)
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

  it('calls cancelPipeline and setPipelineStatus when cancel button is clicked', async () => {
    const user = userEvent.setup()
    mockStoreState.pipelines = new Map([
      ['running-pipeline-1', { id: 'running-pipeline-1', status: 'running' as const, started_at: '2024-01-04T10:00:00Z', completed_nodes: [], current_node: null }],
    ])
    render(<Sidebar />)

    const cancelBtn = screen.getByLabelText('Cancel pipeline')
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(mockCancelPipeline).toHaveBeenCalledWith('running-pipeline-1')
      expect(mockSetPipelineStatus).toHaveBeenCalledWith('running-pipeline-1', 'cancelled')
    })
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

    // Each pipeline button should have a status dot with the correct color class
    // 'running-pipeline-1'.slice(0, 12) === 'running-pipe'
    const runningEntry = screen.getByText('running-pipe').closest('button')!
    // 'completed-pipeline'.slice(0, 12) === 'completed-pi'
    const completedEntry = screen.getByText('completed-pi').closest('button')!
    // 'failed-pipeline-xx'.slice(0, 12) === 'failed-pipel'
    const failedEntry = screen.getByText('failed-pipel').closest('button')!
    // 'cancelled-pipelin'.slice(0, 12) === 'cancelled-pi'
    const cancelledEntry = screen.getByText('cancelled-pi').closest('button')!

    expect(runningEntry.querySelector('.bg-yellow-400')).toBeInTheDocument()
    expect(completedEntry.querySelector('.bg-green-400')).toBeInTheDocument()
    expect(failedEntry.querySelector('.bg-red-400')).toBeInTheDocument()
    expect(cancelledEntry.querySelector('.bg-gray-400')).toBeInTheDocument()
  })
})
