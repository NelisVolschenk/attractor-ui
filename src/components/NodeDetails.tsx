import { useEffect, useState } from 'react'
import type { PipelineEvent } from '../api/types'
import { getNodeResponse } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import { extractLastResponse } from '../utils/responseParser'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeStatus = 'completed' | 'running' | 'failed' | 'pending'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveStatus(events: PipelineEvent[], nodeName: string): NodeStatus {
  const nodeEvents = events.filter(
    (e) => 'name' in e && (e as { name: string }).name === nodeName,
  )

  if (nodeEvents.some((e) => e.event === 'stage_completed')) return 'completed'
  if (nodeEvents.some((e) => e.event === 'stage_failed')) return 'failed'
  if (nodeEvents.some((e) => e.event === 'stage_started')) return 'running'
  return 'pending'
}

function getDuration(events: PipelineEvent[], nodeName: string): number | null {
  const completedEvent = events.find(
    (e) => e.event === 'stage_completed' && 'name' in e && (e as { name: string }).name === nodeName,
  )
  if (completedEvent && completedEvent.event === 'stage_completed') {
    return completedEvent.duration.__duration_ms
  }
  return null
}

function getErrorMessage(events: PipelineEvent[], nodeName: string): string | null {
  const failedEvent = events.find(
    (e) => e.event === 'stage_failed' && 'name' in e && (e as { name: string }).name === nodeName,
  )
  if (failedEvent && failedEvent.event === 'stage_failed') {
    return failedEvent.error
  }
  return null
}

const STATUS_BADGE_CLASSES: Record<NodeStatus, string> = {
  completed: 'bg-green-500',
  running: 'bg-yellow-500',
  failed: 'bg-red-500',
  pending: 'bg-gray-500',
}

// ---------------------------------------------------------------------------
// ResponseTabs — "Response" / "Full History" tabbed view (UI-FEAT-015)
// ---------------------------------------------------------------------------

interface ResponseTabsProps {
  content: string
  activeTab: 'response' | 'history'
  onTabChange: (tab: 'response' | 'history') => void
}

function ResponseTabs({ content, activeTab, onTabChange }: ResponseTabsProps) {
  const extracted = extractLastResponse(content)
  // Only show tabs if the content differs (i.e. there was a separator)
  const hasSeparator = extracted !== content.trim()

  const displayContent = activeTab === 'response' ? extracted : content

  return (
    <div>
      {hasSeparator && (
        <div className="flex gap-1 mb-1" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'response'}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'response'
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => onTabChange('response')}
          >
            Response
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'history'
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
            onClick={() => onTabChange('history')}
          >
            Full History
          </button>
        </div>
      )}
      <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 rounded p-2 max-h-80 overflow-y-auto">
        {displayContent}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NodeDetails component
// ---------------------------------------------------------------------------

export function NodeDetails() {
  const { selectedNodeId, activePipelineId, events } = usePipelineStore()
  const [responseContent, setResponseContent] = useState<string | null | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<'response' | 'history'>('response')

  // Fetch LLM response.md whenever a node is selected (UI-FEAT-012)
  useEffect(() => {
    if (!selectedNodeId || !activePipelineId) {
      setResponseContent(undefined)
      return
    }

    setResponseContent(undefined) // show loading state
    setActiveTab('response')      // reset to response tab on node change

    getNodeResponse(activePipelineId, selectedNodeId)
      .then(({ content }) => setResponseContent(content))
      .catch(() => setResponseContent(null))
  }, [selectedNodeId, activePipelineId])

  if (!selectedNodeId) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        Click a node to see details.
      </div>
    )
  }

  const pipelineEvents: PipelineEvent[] = activePipelineId
    ? (events.get(activePipelineId) ?? [])
    : []

  const status = deriveStatus(pipelineEvents, selectedNodeId)
  const durationMs = getDuration(pipelineEvents, selectedNodeId)
  const errorMessage = getErrorMessage(pipelineEvents, selectedNodeId)

  return (
    <div className="p-4 flex flex-col gap-2 overflow-y-auto h-full">
      <h2 className="text-lg font-semibold text-gray-200">{selectedNodeId}</h2>

      <div>
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs text-white ${STATUS_BADGE_CLASSES[status]}`}
        >
          {status}
        </span>
      </div>

      {durationMs !== null && (
        <div className="text-sm text-gray-400">
          Duration: {(durationMs / 1000).toFixed(2)}s
        </div>
      )}

      {errorMessage && (
        <div className="text-sm text-red-400">{errorMessage}</div>
      )}

      {/* LLM response section (UI-FEAT-012, UI-FEAT-015) */}
      {(status === 'completed' || status === 'running') && (
        <div className="mt-2">
          {responseContent === undefined ? (
            <div className="text-xs text-gray-500 italic">Loading...</div>
          ) : responseContent === null ? (
            <div className="text-xs text-gray-500 italic">Waiting for response...</div>
          ) : (
            <ResponseTabs content={responseContent} activeTab={activeTab} onTabChange={setActiveTab} />
          )}
        </div>
      )}
    </div>
  )
}
