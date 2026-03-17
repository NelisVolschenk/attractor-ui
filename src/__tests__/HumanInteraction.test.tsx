import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QuestionResponse, PipelineSummary } from '../api/types'

// ---------------------------------------------------------------------------
// Hoisted mutable mock state — must be defined before vi.mock() calls
// ---------------------------------------------------------------------------

const mockActivePipelineId = vi.hoisted(() => ({ current: null as string | null }))
const mockQuestions = vi.hoisted(() => ({ current: new Map<string, QuestionResponse[]>() }))
const mockRemoveQuestion = vi.hoisted(() => vi.fn())
const mockPipelines = vi.hoisted(() => ({ current: new Map<string, PipelineSummary>() }))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../store/pipelines', () => ({
  usePipelineStore: () => ({
    activePipelineId: mockActivePipelineId.current,
    questions: mockQuestions.current,
    removeQuestion: mockRemoveQuestion,
    pipelines: mockPipelines.current,
  }),
}))

const mockSubmitAnswer = vi.hoisted(() => vi.fn())
const mockGetNodeResponse = vi.hoisted(() => vi.fn())

vi.mock('../api/client', () => ({
  submitAnswer: mockSubmitAnswer,
  getNodeResponse: mockGetNodeResponse,
}))

// Import after mocks are set up
import { HumanInteraction } from '../components/HumanInteraction'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HumanInteraction', () => {
  beforeEach(() => {
    mockActivePipelineId.current = null
    mockQuestions.current = new Map()
    mockRemoveQuestion.mockClear()
    mockSubmitAnswer.mockClear()
    mockSubmitAnswer.mockResolvedValue({ status: 'ok' })
    mockPipelines.current = new Map()
    mockGetNodeResponse.mockClear()
    mockGetNodeResponse.mockResolvedValue({ content: null })
  })

  it('shows empty state when no pending questions', () => {
    mockActivePipelineId.current = 'pipe-1'
    mockQuestions.current = new Map([['pipe-1', []]])

    render(<HumanInteraction />)

    expect(screen.getByText('No pending questions.')).toBeInTheDocument()
  })

  it('renders confirmation question with Yes/No buttons', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-1',
      text: 'Do you want to proceed?',
      question_type: 'confirmation',
      options: [],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    expect(screen.getByText('Do you want to proceed?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /no/i })).toBeInTheDocument()
  })

  it('renders free_text question with input and submit button', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-2',
      text: 'What is your name?',
      question_type: 'free_text',
      options: [],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    expect(screen.getByText('What is your name?')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it('renders single_select with option buttons', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-3',
      text: 'Choose your color:',
      question_type: 'single_select',
      options: [
        { key: 'red', label: 'Red' },
        { key: 'blue', label: 'Blue' },
        { key: 'green', label: 'Green' },
      ],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    expect(screen.getByText('Choose your color:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Blue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Green' })).toBeInTheDocument()
  })

  it('renders multi_select with checkboxes and submit button', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-4',
      text: 'Select all that apply:',
      question_type: 'multi_select',
      options: [
        { key: 'a', label: 'Option A' },
        { key: 'b', label: 'Option B' },
      ],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    expect(screen.getByText('Select all that apply:')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Option A' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Option B' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument()
  })

  it('submits confirmation answer and removes question from store', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-1',
      text: 'Confirm action?',
      question_type: 'confirmation',
      options: [],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    await user.click(screen.getByRole('button', { name: /yes/i }))

    await waitFor(() => {
      expect(mockSubmitAnswer).toHaveBeenCalledWith('pipe-1', 'q-1', 'yes')
      expect(mockRemoveQuestion).toHaveBeenCalledWith('pipe-1', 'q-1')
    })
  })

  it('submits single_select answer', async () => {
    const user = userEvent.setup()
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-3',
      text: 'Pick one:',
      question_type: 'single_select',
      options: [
        { key: 'opt-a', label: 'Option A' },
        { key: 'opt-b', label: 'Option B' },
      ],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    render(<HumanInteraction />)

    await user.click(screen.getByRole('button', { name: 'Option A' }))

    await waitFor(() => {
      expect(mockSubmitAnswer).toHaveBeenCalledWith('pipe-1', 'q-3', 'opt-a')
      expect(mockRemoveQuestion).toHaveBeenCalledWith('pipe-1', 'q-3')
    })
  })

  // ---------------------------------------------------------------------------
  // UI-FEAT-014: Show previous node LLM response above freeform question input
  // ---------------------------------------------------------------------------

  it('UI-FEAT-014: displays previous LLM response above free_text input when completed nodes exist', async () => {
    // When a free_text question is shown, the component should fetch and display
    // the last completed node's LLM response so the user has context to answer.
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-ft',
      text: 'What direction should we go?',
      question_type: 'free_text',
      options: [],
      created_at: new Date().toISOString(),
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: ['ExploreIdea'],
          current_node: 'BrainstormWithHuman',
        },
      ],
    ])
    mockGetNodeResponse.mockResolvedValue({ content: 'The LLM analyzed the idea and found it promising.' })

    render(<HumanInteraction />)

    await waitFor(() => {
      expect(screen.getByText('The LLM analyzed the idea and found it promising.')).toBeInTheDocument()
    })
    expect(mockGetNodeResponse).toHaveBeenCalledWith('pipe-1', 'ExploreIdea')
  })

  it('UI-FEAT-014: shows loading state while fetching previous LLM response', async () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-ft',
      text: 'What direction?',
      question_type: 'free_text',
      options: [],
      created_at: new Date().toISOString(),
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: ['ExploreIdea'],
          current_node: null,
        },
      ],
    ])
    // Keep the promise pending so we see the loading state
    mockGetNodeResponse.mockImplementation(() => new Promise(() => {}))

    render(<HumanInteraction />)

    // Should show a loading indicator while fetching
    expect(screen.getByText('Loading previous response...')).toBeInTheDocument()
  })

  it('UI-FEAT-014: does not fetch response when no completed nodes', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-ft',
      text: 'What direction?',
      question_type: 'free_text',
      options: [],
      created_at: new Date().toISOString(),
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: [], // no completed nodes
          current_node: null,
        },
      ],
    ])

    render(<HumanInteraction />)

    // No loading state, no response display, no fetch
    expect(screen.queryByText('Loading previous response...')).not.toBeInTheDocument()
    expect(mockGetNodeResponse).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // UI-FEAT-015: Response tab / Full History tab in PreviousNodeResponse
  // ---------------------------------------------------------------------------

  it('UI-FEAT-015: free_text question shows Response and Full History tabs when content has separator', async () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-ft',
      text: 'What direction?',
      question_type: 'free_text',
      options: [],
      created_at: new Date().toISOString(),
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: ['ExploreIdea'],
          current_node: null,
        },
      ],
    ])
    const fullContent = '[tool_call] analyze\n[tool_result] done\n---\nHere is the LLM summary.'
    mockGetNodeResponse.mockResolvedValue({ content: fullContent })

    render(<HumanInteraction />)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /response/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /full history/i })).toBeInTheDocument()
    })
  })

  it('UI-FEAT-015: free_text question Response tab shows extracted response (not full history)', async () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-ft',
      text: 'What direction?',
      question_type: 'free_text',
      options: [],
      created_at: new Date().toISOString(),
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
    mockPipelines.current = new Map([
      [
        'pipe-1',
        {
          id: 'pipe-1',
          status: 'running',
          started_at: new Date().toISOString(),
          completed_nodes: ['ExploreIdea'],
          current_node: null,
        },
      ],
    ])
    const fullContent = '[tool_call] analyze\n[tool_result] done\n---\nHere is the LLM summary.'
    mockGetNodeResponse.mockResolvedValue({ content: fullContent })

    render(<HumanInteraction />)

    await waitFor(() => {
      // Should show the extracted response (not full content with tool calls)
      expect(screen.getByText('Here is the LLM summary.')).toBeInTheDocument()
      expect(screen.queryByText('[tool_call] analyze')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // UI-BUG-018: Cancel disables submit in HumanInteraction
  // ---------------------------------------------------------------------------

  it('UI-BUG-018: submit button is disabled when pipeline is cancelled', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-1',
      text: 'Do you want to proceed?',
      question_type: 'confirmation',
      options: [],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])
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

    render(<HumanInteraction />)

    // When pipeline is cancelled, all submit/answer buttons should be disabled
    const yesBtn = screen.getByRole('button', { name: /yes/i })
    expect(yesBtn).toBeDisabled()
    const noBtn = screen.getByRole('button', { name: /no/i })
    expect(noBtn).toBeDisabled()
  })

  it('has orange pulsing border when question is pending', () => {
    mockActivePipelineId.current = 'pipe-1'
    const question: QuestionResponse = {
      qid: 'q-1',
      text: 'A question',
      question_type: 'confirmation',
      options: [],
      created_at: '2024-01-01T00:00:00Z',
    }
    mockQuestions.current = new Map([['pipe-1', [question]]])

    const { container } = render(<HumanInteraction />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('border-2')
    expect(wrapper).toHaveClass('border-orange-500')
    expect(wrapper).toHaveClass('animate-pulse')
  })
})
