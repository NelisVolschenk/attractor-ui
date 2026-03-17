import { create } from 'zustand'
import type { PipelineSummary, PipelineEvent, QuestionResponse } from '../api/types'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface PipelineState {
  pipelines: Map<string, PipelineSummary>
  activePipelineId: string | null
  events: Map<string, PipelineEvent[]>
  questions: Map<string, QuestionResponse[]>
  selectedNodeId: string | null
  sseStatus: 'connected' | 'reconnecting' | 'disconnected'
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface PipelineActions {
  /** Replace the entire pipeline map from a list */
  setPipelines: (list: PipelineSummary[]) => void
  /** Set or clear the active pipeline id */
  setActivePipeline: (id: string | null) => void
  /** Append an event and update pipeline metadata based on event type */
  addEvent: (pipelineId: string, event: PipelineEvent) => void
  /** Set the questions array for a pipeline */
  setQuestions: (pipelineId: string, questions: QuestionResponse[]) => void
  /** Remove a question from a pipeline by qid */
  removeQuestion: (pipelineId: string, qid: string) => void
  /** Delete the event list for a pipeline */
  clearPipelineEvents: (pipelineId: string) => void
  /** Set or clear the selected graph node id */
  selectNode: (nodeId: string | null) => void
  /** Set the SSE connection status */
  setSseStatus: (status: 'connected' | 'reconnecting' | 'disconnected') => void
  /** Update the lifecycle status of a single pipeline (e.g. after cancel) */
  setPipelineStatus: (pipelineId: string, status: PipelineSummary['status']) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const usePipelineStore = create<PipelineState & PipelineActions>((set) => ({
  // --- initial state ---
  pipelines: new Map(),
  activePipelineId: null,
  events: new Map(),
  questions: new Map(),
  selectedNodeId: null,
  sseStatus: 'disconnected',

  // --- actions ---

  setPipelines: (list) => {
    const map = new Map<string, PipelineSummary>()
    for (const pipeline of list) {
      map.set(pipeline.id, pipeline)
    }
    set({ pipelines: map })
  },

  setActivePipeline: (id) => {
    set({ activePipelineId: id })
  },

  addEvent: (pipelineId, event) => {
    set((state) => {
      // Append event to event list
      const prevEvents = state.events.get(pipelineId) ?? []
      const newEvents = new Map(state.events)
      newEvents.set(pipelineId, [...prevEvents, event])

      // Update pipeline metadata based on event type
      const newPipelines = new Map(state.pipelines)
      const pipeline = newPipelines.get(pipelineId)

      if (pipeline) {
        if (event.event === 'stage_started') {
          newPipelines.set(pipelineId, { ...pipeline, current_node: event.name })
        } else if (event.event === 'stage_completed') {
          newPipelines.set(pipelineId, {
            ...pipeline,
            completed_nodes: [...pipeline.completed_nodes, event.name],
            current_node: null,
          })
        } else if (event.event === 'pipeline_completed') {
          newPipelines.set(pipelineId, { ...pipeline, status: 'completed' })
        } else if (event.event === 'pipeline_failed') {
          newPipelines.set(pipelineId, { ...pipeline, status: 'failed' })
        }
      }

      // Handle interview events — update questions map
      const newQ = new Map(state.questions)

      if (event.event === 'interview_started') {
        const prev = newQ.get(pipelineId) ?? []
        const newQuestion = {
          qid: `auto-${event.stage}`,
          text: event.question,
          question_type: 'confirmation' as const,
          options: [],
          created_at: new Date().toISOString(),
        }
        newQ.set(pipelineId, [...prev, newQuestion])
        return { events: newEvents, pipelines: newPipelines, questions: newQ }
      } else if (event.event === 'interview_completed') {
        const prev = newQ.get(pipelineId) ?? []
        newQ.set(pipelineId, prev.filter((q) => q.text !== event.question))
        return { events: newEvents, pipelines: newPipelines, questions: newQ }
      }

      return { events: newEvents, pipelines: newPipelines }
    })
  },

  setQuestions: (pipelineId, questions) => {
    set((state) => {
      const newQuestions = new Map(state.questions)
      newQuestions.set(pipelineId, questions)
      return { questions: newQuestions }
    })
  },

  removeQuestion: (pipelineId, qid) => {
    set((state) => {
      const existing = state.questions.get(pipelineId) ?? []
      const newQuestions = new Map(state.questions)
      newQuestions.set(pipelineId, existing.filter((q) => q.qid !== qid))
      return { questions: newQuestions }
    })
  },

  clearPipelineEvents: (pipelineId) => {
    set((state) => {
      const newEvents = new Map(state.events)
      newEvents.delete(pipelineId)
      return { events: newEvents }
    })
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId })
  },

  setSseStatus: (status) => {
    set({ sseStatus: status })
  },

  setPipelineStatus: (pipelineId, status) => {
    set((state) => {
      const existing = state.pipelines.get(pipelineId)
      if (!existing) return {}
      const newPipelines = new Map(state.pipelines)
      newPipelines.set(pipelineId, { ...existing, status })
      return { pipelines: newPipelines }
    })
  },
}))
