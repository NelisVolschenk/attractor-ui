import { useEffect, useRef } from 'react'
import { subscribeToPipeline } from '../api/sse'
import type { SubscriptionHandle } from '../api/sse'
import { getQuestions } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import type { QuestionResponse } from '../api/types'

/** How often (ms) to poll the questions endpoint while an SSE session is active. */
const QUESTION_POLL_INTERVAL_MS = 2000

/**
 * Maximum number of SSE events to process per pipeline connection (UI-BUG-008).
 *
 * When a pipeline has 24K+ events (e.g. from an infinite loop), replaying all
 * of them overwhelms the browser.  Only the first REPLAY_CAP events are
 * forwarded to the store; a synthetic "events_capped" notice is injected at
 * the boundary so the UI can inform the user.
 */
export const REPLAY_CAP = 1000

/**
 * Fast equality check for two question arrays.
 *
 * Compares length and qid of each item.  Order matters — questions are
 * displayed in arrival order, so a reorder is treated as a change.
 */
function questionsEqual(a: QuestionResponse[], b: QuestionResponse[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].qid !== b[i].qid) return false
  }
  return true
}

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
 * - Polls GET /questions every 2 s as a reliable fallback, because the
 *   server does not currently emit interview_started SSE events
 *
 * Performance:
 * - Only updates the Zustand store when the question list actually changes
 *   (prevents cascade re-renders on every poll tick).
 * - Caps SSE events at REPLAY_CAP to prevent browser overload from
 *   pipelines with thousands of replayed events (UI-BUG-008).
 * - Polls for questions regardless of pipeline status so that questions
 *   are visible even for cancelled/failed pipelines (UI-BUG-009).
 *
 * Cleans up the subscription on unmount.
 */
export function usePipelineEvents(pipelineId: string | null): void {
  const subscriptionRef = useRef<SubscriptionHandle | null>(null)
  const prevPipelineIdRef = useRef<string | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Tracks the last questions array written to the store for this pipeline. */
  const prevQuestionsRef = useRef<QuestionResponse[]>([])

  useEffect(() => {
    const { addEvent, clearPipelineEvents, setSseStatus, setQuestions } =
      usePipelineStore.getState()

    // Close existing connection and clear events for the previous pipeline
    if (subscriptionRef.current !== null) {
      subscriptionRef.current.close()
      subscriptionRef.current = null
    }
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (prevPipelineIdRef.current !== null) {
      clearPipelineEvents(prevPipelineIdRef.current)
    }

    prevPipelineIdRef.current = pipelineId
    prevQuestionsRef.current = []

    // Open new SSE connection if pipelineId is provided
    if (pipelineId !== null) {
      // UI-BUG-008: cap the number of events forwarded to the store.
      // A pipeline with an infinite loop can produce 24K+ events; processing
      // all of them overwhelms the browser.  We count events received for this
      // connection and stop forwarding once we hit REPLAY_CAP.
      let eventsReceived = 0

      subscriptionRef.current = subscribeToPipeline(pipelineId, {
        onEvent: (event) => {
          eventsReceived++

          if (eventsReceived > REPLAY_CAP) {
            // Already capped — discard this event.
            return
          }

          // Forward the event to the store.
          addEvent(pipelineId, event)

          // At exactly the cap boundary, inject a synthetic notice so the UI
          // can inform the user that earlier events are not shown.
          if (eventsReceived === REPLAY_CAP) {
            addEvent(pipelineId, {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              event: 'events_capped' as any,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              count: eventsReceived,
            } as any)
          }

          // When a human-in-the-loop interview starts, the SSE event only
          // carries the question text and stage name.  The full question
          // (real UUID qid, correct question_type, options) lives on the
          // server.  Fetch it immediately so HumanInteraction can render the
          // right UI and submit answers with the correct qid.
          if (event.event === 'interview_started') {
            getQuestions(pipelineId)
              .then(({ questions }) => {
                if (!questionsEqual(prevQuestionsRef.current, questions)) {
                  prevQuestionsRef.current = questions
                  setQuestions(pipelineId, questions)
                }
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

      // Poll for pending questions periodically.
      //
      // UI-BUG-009: poll for questions even when the pipeline is in a
      // non-running terminal state such as 'cancelled' or 'failed'.  A human
      // gate question that was pending when the pipeline was cancelled should
      // still be visible (and answerable) in the UI.
      //
      // The ONLY status that stops polling is 'completed' — a successfully
      // completed pipeline will never have new questions, so continuing to
      // poll wastes bandwidth.  Cancelled and failed pipelines may still have
      // pending questions that the user needs to dismiss.
      //
      // Performance: skip the store update when the result is unchanged
      // (avoids triggering React re-renders on every tick).
      pollIntervalRef.current = setInterval(() => {
        const state = usePipelineStore.getState()
        const pipeline = state.pipelines?.get(pipelineId)

        // Stop polling only when the pipeline completed successfully — at
        // that point no new human-gate questions can arise.
        if (pipeline?.status === 'completed') {
          if (pollIntervalRef.current !== null) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          return
        }

        getQuestions(pipelineId)
          .then(({ questions }) => {
            // Only update the store when the question list actually changes.
            // Unconditional updates create a new Map reference on every tick,
            // triggering store-subscriber re-renders even when nothing changed.
            if (!questionsEqual(prevQuestionsRef.current, questions)) {
              prevQuestionsRef.current = questions
              state.setQuestions(pipelineId, questions)
            }
          })
          .catch(() => {
            // Best-effort: network blip or pipeline gone — silently skip.
          })
      }, QUESTION_POLL_INTERVAL_MS)
    }

    // Cleanup on unmount or before next effect run
    return () => {
      if (subscriptionRef.current !== null) {
        subscriptionRef.current.close()
        subscriptionRef.current = null
      }
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [pipelineId])
}
