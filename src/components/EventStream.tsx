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

  // Parallel branch completed: color by success/failure (UI-BUG-020)
  if (type === 'parallel_branch_completed') {
    const bc = event as { success: boolean }
    return bc.success
      ? { icon: '✓', colorClass: 'text-green-400' }
      : { icon: '✗', colorClass: 'text-red-400' }
  }

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
// Task 3a: Short event labels — node name first, then short label
// ---------------------------------------------------------------------------

function getShortLabel(event: PipelineEvent): string {
  switch (event.event) {
    case 'stage_started': return 'started'
    case 'stage_completed': {
      const dur = event.duration.__duration_ms
      return `completed (${(dur / 1000).toFixed(1)}s)`
    }
    case 'stage_failed': return 'failed'
    case 'stage_retrying': return `retrying (attempt ${event.attempt})`
    case 'parallel_branch_started': return 'branch started'
    case 'parallel_branch_completed':
      return (event as { success: boolean }).success ? 'branch done' : 'branch failed'
    case 'parallel_started': return 'parallel started'
    case 'parallel_completed': {
      const pc = event as { success_count: number; failure_count: number }
      return `parallel done (${pc.success_count}✓ ${pc.failure_count}✗)`
    }
    case 'pipeline_started': return 'pipeline started'
    case 'pipeline_completed': return 'pipeline done'
    case 'pipeline_failed': return 'pipeline failed'
    case 'interview_started': return 'waiting for input'
    case 'interview_completed': return 'answered'
    case 'interview_timeout': return 'input timed out'
    case 'checkpoint_saved': return 'checkpoint saved'
    default: return (event as { event: string }).event
  }
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
// Task 3b: Collapsed view — one row per (node, pass) that updates live
// ---------------------------------------------------------------------------

interface CollapsedRow {
  nodeName: string
  passNumber: number // 1-based
  latestEvent: PipelineEvent
  isRunning: boolean
}

function buildCollapsedRows(events: PipelineEvent[]): CollapsedRow[] {
  const rows: CollapsedRow[] = []
  /** nodeName → how many stage_started events seen so far */
  const passCount = new Map<string, number>()
  /** `${nodeName}:${passNumber}` → index in rows array */
  const rowMap = new Map<string, number>()

  for (const event of events) {
    const nodeName = getNodeName(event)

    // Non-stage / pipeline-level events (no node name) pass through as-is
    if (!nodeName) {
      rows.push({ nodeName: '', passNumber: 0, latestEvent: event, isRunning: false })
      continue
    }

    // Only collapse stage-level events; others pass through
    if (
      event.event !== 'stage_started' &&
      event.event !== 'stage_completed' &&
      event.event !== 'stage_failed' &&
      event.event !== 'stage_retrying'
    ) {
      rows.push({ nodeName, passNumber: 0, latestEvent: event, isRunning: false })
      continue
    }

    if (event.event === 'stage_started') {
      const pass = (passCount.get(nodeName) ?? 0) + 1
      passCount.set(nodeName, pass)
      const key = `${nodeName}:${pass}`
      rows.push({ nodeName, passNumber: pass, latestEvent: event, isRunning: true })
      rowMap.set(key, rows.length - 1)
    } else {
      const pass = passCount.get(nodeName) ?? 0
      if (pass === 0) {
        // Orphan completion (no prior stage_started) — create a row for it
        passCount.set(nodeName, 1)
        const key = `${nodeName}:1`
        rows.push({ nodeName, passNumber: 1, latestEvent: event, isRunning: false })
        rowMap.set(key, rows.length - 1)
      } else {
        const key = `${nodeName}:${pass}`
        const idx = rowMap.get(key)
        if (idx !== undefined) {
          rows[idx] = {
            ...rows[idx],
            latestEvent: event,
            isRunning: event.event === 'stage_retrying',
          }
        }
      }
    }
  }

  return rows
}

// ---------------------------------------------------------------------------
// EventStream component
// ---------------------------------------------------------------------------

/**
 * Virtualized event log panel.
 *
 * UI-BUG-007: Uses react-virtuoso to only render visible events.
 * UI-FEAT-013: Running stages show a pulsing indicator + elapsed timer.
 * Task 3a: Node name shown first, then short label.
 * Task 3b: Collapsible view groups events by (node, pass).
 */
const TERMINAL_STATUSES = new Set(['cancelled', 'completed', 'failed'])

export function EventStream() {
  const { activePipelineId, events, selectNode, selectNodeWithInstance, sseStatus, questions, pipelines } = usePipelineStore()
  const [pinned, setPinned] = useState(true)
  // Task 3b: collapsed mode ON by default
  const [collapsed, setCollapsed] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  // Tick state increments every second to re-render elapsed timers (UI-FEAT-013)
  const [tick, setTick] = useState(0)
  // Map from node name to the Date.now() when we first saw stage_started
  const runningStartTimesRef = useRef<Map<string, number>>(new Map())

  const pipelineEvents: PipelineEvent[] = activePipelineId
    ? (events.get(activePipelineId) ?? [])
    : []

  // Compute currently-running nodes.
  const activePipeline = activePipelineId ? pipelines.get(activePipelineId) : undefined
  const isPipelineTerminal = activePipeline ? TERMINAL_STATUSES.has(activePipeline.status) : false
  const runningNodes = isPipelineTerminal
    ? new Set<string>()
    : getRunningNodes(pipelineEvents)

  // Update runningStartTimes when running nodes change (UI-FEAT-013)
  useEffect(() => {
    const now = Date.now()
    for (const name of runningNodes) {
      if (!runningStartTimesRef.current.has(name)) {
        runningStartTimesRef.current.set(name, now)
      }
    }
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

  // Suppress unused tick warning — it's used to force re-renders for timers
  void tick

  // Task 3b: Build collapsed rows
  const collapsedRows = collapsed ? buildCollapsedRows(pipelineEvents) : []

  const hasHumanQuestion = activePipelineId
    ? (questions.get(activePipelineId)?.length ?? 0) > 0
    : false

  // ---------------------------------------------------------------------------
  // Render a single flat event row (used in both flat & (future) collapsed modes)
  // ---------------------------------------------------------------------------
  function renderFlatRow(i: number, event: PipelineEvent) {
    const { icon, colorClass } = getEventStyle(event)
    const nodeName = getNodeName(event)
    const isRunningStart =
      event.event === 'stage_started' &&
      nodeName !== null &&
      runningNodes.has(nodeName)

    const startTime = nodeName ? runningStartTimesRef.current.get(nodeName) : undefined
    const elapsedMs = startTime !== undefined ? Date.now() - startTime : 0
    const elapsedS = Math.floor(elapsedMs / 1000)

    const shortLabel = getShortLabel(event)

    // Compute pass number for this event (for instance navigation)
    function computePassForEvent(): number {
      let pass = 0
      for (let j = 0; j <= i && j < pipelineEvents.length; j++) {
        const e = pipelineEvents[j]
        if (getNodeName(e) === nodeName && e.event === 'stage_started') pass++
      }
      return pass || 1
    }

    return (
      <li
        key={i}
        className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-900 cursor-pointer text-sm list-none"
        onClick={() => {
          if (nodeName) {
            const pass = computePassForEvent()
            selectNodeWithInstance(nodeName, pass)
          } else {
            selectNode(nodeName)
          }
        }}
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

        {/* Task 3a: node name first, then short label */}
        {nodeName ? (
          <span className="text-gray-100 font-medium truncate">{nodeName}</span>
        ) : null}
        <span className="text-gray-500 shrink-0">
          {nodeName ? `— ${shortLabel}` : shortLabel}
        </span>

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
  }

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
            {collapsed ? collapsedRows.length : pipelineEvents.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Task 3b: Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`text-xs px-2 py-0.5 rounded ${collapsed ? 'bg-blue-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
            title={collapsed ? 'Showing collapsed (one row per node pass) — click to expand' : 'Showing all events — click to collapse'}
            aria-label={collapsed ? 'Collapse events' : 'Expand events'}
          >
            {collapsed ? '⊟ grouped' : '⊞ all'}
          </button>
          <button
            onClick={() => setPinned(!pinned)}
            className={`text-xs ${pinned ? 'text-blue-400' : 'text-gray-500'}`}
            aria-label={pinned ? 'Unpin from bottom' : 'Pin to bottom'}
          >
            ⇓ {pinned ? 'pinned' : 'unpinned'}
          </button>
        </div>
      </div>

      {/* Event list */}
      {collapsed ? (
        // Task 3b: Collapsed view — one row per (node, pass)
        collapsedRows.length === 0 ? (
          <div className="p-4 text-gray-500 text-sm">No events yet.</div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="flex-1"
            style={{ minHeight: 0 }}
            data={collapsedRows}
            followOutput={pinned ? 'smooth' : false}
            atBottomStateChange={(atBottom) => setPinned(atBottom)}
            defaultItemHeight={36}
            itemContent={(_i, row) => {
              const { colorClass } = getEventStyle(row.latestEvent)
              const isRunning = row.isRunning && runningNodes.has(row.nodeName)
              const shortLabel = getShortLabel(row.latestEvent)
              const startTime = runningStartTimesRef.current.get(row.nodeName)
              const elapsedMs = startTime !== undefined ? Date.now() - startTime : 0
              const elapsedS = Math.floor(elapsedMs / 1000)

              return (
                <li
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-900 cursor-pointer text-sm list-none"
                  onClick={() => selectNodeWithInstance(row.nodeName, row.passNumber)}
                >
                  {isRunning ? (
                    <span
                      className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0"
                      aria-label="running"
                    />
                  ) : (
                    <span className={colorClass}>
                      {getEventStyle(row.latestEvent).icon}
                    </span>
                  )}
                  <span className="text-gray-100 font-medium truncate">{row.nodeName}</span>
                  <span className="text-gray-500 shrink-0">— {shortLabel}</span>
                  {isRunning && (
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
        )
      ) : (
        // Flat view — all raw events
        pipelineEvents.length === 0 ? (
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
            itemContent={(i, event) => renderFlatRow(i, event)}
          />
        )
      )}
    </div>
  )
}
