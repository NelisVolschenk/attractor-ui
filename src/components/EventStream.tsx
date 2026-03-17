import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { PipelineEvent } from '../api/types'
import { usePipelineStore } from '../store/pipelines'
import { ErrorBanner } from './ErrorBanner'

// ---------------------------------------------------------------------------
// Color coding helpers
// ---------------------------------------------------------------------------

interface EventStyle {
  icon: string
  colorClass: string
}

function getEventStyle(event: PipelineEvent): EventStyle {
  const type = event.event
  if (type.includes('completed')) {
    return { icon: '✓', colorClass: 'text-green-400' }
  }
  if (type.includes('started')) {
    return { icon: '⟳', colorClass: 'text-yellow-400' }
  }
  if (type.includes('failed')) {
    return { icon: '✗', colorClass: 'text-red-400' }
  }
  return { icon: 'ℹ', colorClass: 'text-blue-400' }
}

function getNodeName(event: PipelineEvent): string | null {
  if ('name' in event && typeof event.name === 'string') return event.name
  if ('branch' in event && typeof event.branch === 'string') return event.branch
  if ('node_id' in event && typeof event.node_id === 'string') return event.node_id
  return null
}

// ---------------------------------------------------------------------------
// LLM progress helpers (UI-FEAT-013)
// ---------------------------------------------------------------------------

/**
 * Build a set of node IDs that are currently running
 * (stage_started without a subsequent stage_completed or stage_failed).
 */
function getRunningNodes(events: PipelineEvent[]): Set<string> {
  const started = new Set<string>()
  const finished = new Set<string>()
  for (const event of events) {
    const name = getNodeName(event)
    if (!name) continue
    if (event.event === 'stage_started') started.add(name)
    else if (event.event === 'stage_completed' || event.event === 'stage_failed') {
      finished.add(name)
    }
  }
  for (const name of finished) started.delete(name)
  return started
}

// ---------------------------------------------------------------------------
// EventStream component
// ---------------------------------------------------------------------------

/**
 * Virtualized event log panel.
 *
 * UI-BUG-007: Uses react-virtuoso to only render visible events.
 * UI-FEAT-013: Running stages show a pulsing indicator + elapsed timer.
 */
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'failed'])

export function EventStream() {
  const { activePipelineId, events, selectNode, sseStatus, questions, pipelines } = usePipelineStore()
  const [pinned, setPinned] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // Tick state increments every second to re-render elapsed timers (UI-FEAT-013)
  const [tick, setTick] = useState(0)
  // Map from node name to the Date.now() when we first saw stage_started
  const runningStartTimesRef = useRef<Map<string, number>>(new Map())

  const pipelineEvents: PipelineEvent[] = activePipelineId
    ? (events.get(activePipelineId) ?? [])
    : []

  // Compute currently-running nodes.
  // If the pipeline is in a terminal state (cancelled/completed/failed) treat
  // all nodes as finished — the pulsing indicator and tick timer must stop.
  const activePipeline = activePipelineId ? pipelines.get(activePipelineId) : undefined
  const isPipelineTerminal = activePipeline ? TERMINAL_STATUSES.has(activePipeline.status) : false
  const runningNodes = isPipelineTerminal
    ? new Set<string>()
    : getRunningNodes(pipelineEvents)

  // Update runningStartTimes when running nodes change (UI-FEAT-013)
  useEffect(() => {
    const now = Date.now()
    // Add new running nodes
    for (const name of runningNodes) {
      if (!runningStartTimesRef.current.has(name)) {
        runningStartTimesRef.current.set(name, now)
      }
    }
    // Remove nodes that are no longer running
    for (const name of runningStartTimesRef.current.keys()) {
      if (!runningNodes.has(name)) {
        runningStartTimesRef.current.delete(name)
      }
    }
  })

  // Tick every second to update elapsed timers while there are running nodes
  useEffect(() => {
    if (runningNodes.size === 0) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [runningNodes.size])

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      {/* Reconnection banners */}
      {sseStatus === 'reconnecting' && (
        <ErrorBanner message="Connection lost. Reconnecting..." variant="warning" />
      )}
      {sseStatus === 'disconnected' && activePipelineId && (
        <ErrorBanner message="Disconnected from server. Events may be stale." variant="error" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">Events</span>
          <span className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5">
            {pipelineEvents.length}
          </span>
        </div>
        <button
          onClick={() => setPinned(!pinned)}
          className={`text-xs ${pinned ? 'text-blue-400' : 'text-gray-500'}`}
          aria-label={pinned ? 'Unpin from bottom' : 'Pin to bottom'}
        >
          ⇓ {pinned ? 'pinned' : 'unpinned'}
        </button>
      </div>

      {/* Event list — virtualized so only visible events hit the DOM */}
      {pipelineEvents.length === 0 ? (
        <div className="p-4 text-gray-500 text-sm">No events yet.</div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="flex-1"
          style={{ minHeight: 0 }}
          data={pipelineEvents}
          followOutput={pinned ? 'smooth' : false}
          atBottomStateChange={(atBottom) => setPinned(atBottom)}
          defaultItemHeight={36}
          itemContent={(i, event) => {
            const { icon, colorClass } = getEventStyle(event)
            const nodeName = getNodeName(event)
            const isRunningStart =
              event.event === 'stage_started' &&
              nodeName !== null &&
              runningNodes.has(nodeName)

            // Compute elapsed seconds for running nodes
            const startTime = nodeName ? runningStartTimesRef.current.get(nodeName) : undefined
            const elapsedMs = startTime !== undefined ? Date.now() - startTime : 0
            const elapsedS = Math.floor(elapsedMs / 1000)
            // Suppress unused tick warning — it's used to force re-renders
            void tick

            // Determine if a human gate is active for the current pipeline (UI-BUG-015)
            const hasHumanQuestion = activePipelineId
              ? (questions.get(activePipelineId)?.length ?? 0) > 0
              : false

            return (
              <li
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-900 cursor-pointer text-sm list-none"
                onClick={() => selectNode(nodeName)}
              >
                {/* Pulsing dot for running stages (UI-FEAT-013) */}
                {isRunningStart ? (
                  <span
                    className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0"
                    aria-label="LLM running"
                  />
                ) : (
                  <span className={colorClass}>{icon}</span>
                )}
                <span className="text-gray-300">{event.event}</span>
                {nodeName && (
                  <span className="text-gray-500 truncate">{nodeName}</span>
                )}
                {/* Elapsed timer + progress text for running stages (UI-FEAT-013, UI-BUG-015) */}
                {isRunningStart && (
                  <span className="ml-auto text-xs text-gray-500 shrink-0 flex items-center gap-1">
                    {!hasHumanQuestion && elapsedS > 0 && <span>{elapsedS}s</span>}
                    {hasHumanQuestion ? (
                      <span className="text-orange-400 italic">Waiting for human input...</span>
                    ) : (
                      elapsedS >= 5 && (
                        <span className="text-yellow-500 italic">LLM call in progress...</span>
                      )
                    )}
                  </span>
                )}
              </li>
            )
          }}
        />
      )}
    </div>
  )
}
