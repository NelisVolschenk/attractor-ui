import { useRef, useState } from 'react'
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
// EventStream component
// ---------------------------------------------------------------------------

/**
 * Virtualized event log panel.
 *
 * UI-BUG-007: The previous implementation rendered ALL events as DOM nodes.
 * With 24K+ events from an infinite loop this killed the browser.
 *
 * This version uses react-virtuoso to only render the events visible in the
 * scroll viewport.  The total event count is always shown at the top.
 * Auto-scroll-to-bottom ("pinned") follows new events until the user scrolls
 * up manually.
 */
export function EventStream() {
  const { activePipelineId, events, selectNode, sseStatus } = usePipelineStore()
  const [pinned, setPinned] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)

  const pipelineEvents: PipelineEvent[] = activePipelineId
    ? (events.get(activePipelineId) ?? [])
    : []

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
            return (
              <li
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-900 cursor-pointer text-sm list-none"
                onClick={() => selectNode(nodeName)}
              >
                <span className={colorClass}>{icon}</span>
                <span className="text-gray-300">{event.event}</span>
                {nodeName && (
                  <span className="text-gray-500 truncate">{nodeName}</span>
                )}
              </li>
            )
          }}
        />
      )}
    </div>
  )
}
