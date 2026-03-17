import { useEffect, useRef } from 'react'
import { subscribeToPipeline } from '../api/sse'
import type { SubscriptionHandle } from '../api/sse'
import { getQuestions } from '../api/client'
import { usePipelineStore } from '../store/pipelines'

/**
 * React hook that subscribes to a pipeline's SSE event stream.
 *
 * When pipelineId changes:
 * - Closes the existing SSE connection
 * - Clears events for the old pipeline
 * - Opens a new SSE connection with ?since=0
 * - Dispatches each event to the Zustand store via addEvent
 * - Reports connection lifecycle to the store via setSseStatus
 * - On interview_started, fetches real question data from the API so
 *   the HumanInteraction pane shows the correct qid, type, and options
 *
 * Cleans up the subscription on unmount.
 */
export function usePipelineEvents(pipelineId: string | null): void {
  const subscriptionRef = useRef<SubscriptionHandle | null>(null)
  const prevPipelineIdRef = useRef<string | null>(null)

  useEffect(() => {
    const { addEvent, clearPipelineEvents, setSseStatus, setQuestions } =
      usePipelineStore.getState()

    // Close existing connection and clear events for the previous pipeline
    if (subscriptionRef.current !== null) {
      subscriptionRef.current.close()
      subscriptionRef.current = null
    }
    if (prevPipelineIdRef.current !== null) {
      clearPipelineEvents(prevPipelineIdRef.current)
    }

    prevPipelineIdRef.current = pipelineId

    // Open new SSE connection if pipelineId is provided
    if (pipelineId !== null) {
      subscriptionRef.current = subscribeToPipeline(pipelineId, {
        onEvent: (event) => {
          addEvent(pipelineId, event)

          // When a human-in-the-loop interview starts, the SSE event only
          // carries the question text and stage name.  The full question
          // (real UUID qid, correct question_type, options) lives on the
          // server.  Fetch it immediately so HumanInteraction can render the
          // right UI and submit answers with the correct qid.
          if (event.event === 'interview_started') {
            getQuestions(pipelineId)
              .then(({ questions }) => {
                setQuestions(pipelineId, questions)
              })
              .catch(() => {
                // Best-effort: if the fetch fails the synthetic placeholder
                // added by addEvent remains visible as a fallback.
              })
          }
        },
        onOpen: () => {
          setSseStatus('connected')
        },
        onError: () => {
          setSseStatus('reconnecting')
        },
        onFallback: () => {
          setSseStatus('disconnected')
        },
      })
    }

    // Cleanup on unmount or before next effect run
    return () => {
      if (subscriptionRef.current !== null) {
        subscriptionRef.current.close()
        subscriptionRef.current = null
      }
    }
  }, [pipelineId])
}
