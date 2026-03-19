import { useEffect, useState, useCallback } from 'react'
import type { PipelineEvent, BranchResult } from '../api/types'
import { getNodeResponse, getContext, getFiles, getFileContent } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import { extractLastResponse } from '../utils/responseParser'
import { FileExplorer } from './FileExplorer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeStatus = 'completed' | 'running' | 'failed' | 'pending'
type PanelTab = 'node' | 'files'

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

/** Derive status for a specific pass (1-based instanceIndex). */
function deriveStatusForInstance(
  events: PipelineEvent[],
  nodeName: string,
  instanceIndex: number,
): NodeStatus {
  let passCount = 0
  let inInstance = false

  for (const event of events) {
    if (!('name' in event) || (event as { name: string }).name !== nodeName) continue
    if (event.event === 'stage_started') {
      passCount++
      if (passCount === instanceIndex) inInstance = true
      else if (passCount > instanceIndex) break
    } else if (inInstance) {
      if (event.event === 'stage_completed') return 'completed'
      if (event.event === 'stage_failed') return 'failed'
    }
  }

  return inInstance ? 'running' : 'pending'
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

/** Get duration for a specific pass (1-based). */
function getDurationForInstance(
  events: PipelineEvent[],
  nodeName: string,
  instanceIndex: number,
): number | null {
  let passCount = 0
  let inInstance = false

  for (const event of events) {
    if (!('name' in event) || (event as { name: string }).name !== nodeName) continue
    if (event.event === 'stage_started') {
      passCount++
      if (passCount === instanceIndex) inInstance = true
      else if (passCount > instanceIndex) break
    } else if (inInstance && event.event === 'stage_completed') {
      return event.duration.__duration_ms
    }
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

/** Count how many times a node has been started (= number of instances). */
function countInstances(events: PipelineEvent[], nodeName: string): number {
  return events.filter(
    (e) => e.event === 'stage_started' && 'name' in e && (e as { name: string }).name === nodeName,
  ).length
}

const STATUS_BADGE_CLASSES: Record<NodeStatus, string> = {
  completed: 'bg-green-500',
  running: 'bg-yellow-500',
  failed: 'bg-red-500',
  pending: 'bg-gray-500',
}

// ---------------------------------------------------------------------------
// Parallel branch result helpers (UI-BUG-020)
// ---------------------------------------------------------------------------

/** Check if pipeline events indicate a parallel fan-out happened for this node. */
function hasParallelEvents(events: PipelineEvent[]): boolean {
  return events.some(
    (e) => e.event === 'parallel_started' || e.event === 'parallel_completed',
  )
}

const BRANCH_STATUS_ICON: Record<string, string> = {
  success: '✓',
  partial_success: '◑',
  retry: '↻',
  skipped: '–',
  fail: '✗',
}

const BRANCH_STATUS_COLOR: Record<string, string> = {
  success: 'text-green-400',
  partial_success: 'text-yellow-400',
  retry: 'text-yellow-400',
  skipped: 'text-gray-400',
  fail: 'text-red-400',
}

// ---------------------------------------------------------------------------
// BranchResults — per-branch expand/collapse display (UI-BUG-020)
// ---------------------------------------------------------------------------

interface BranchResultsProps {
  results: BranchResult[]
  pipelineId: string
}

function BranchResults({ results, pipelineId }: BranchResultsProps) {
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null)
  const [branchResponse, setBranchResponse] = useState<string | null>(null)
  const [loadingBranch, setLoadingBranch] = useState(false)

  const successCount = results.filter((r) => r.status === 'success' || r.status === 'partial_success').length
  const failCount = results.filter((r) => r.status === 'fail').length

  const handleToggle = (branchId: string) => {
    if (expandedBranch === branchId) {
      setExpandedBranch(null)
      setBranchResponse(null)
      return
    }
    setExpandedBranch(branchId)
    setBranchResponse(null)
    setLoadingBranch(true)
    getNodeResponse(pipelineId, branchId)
      .then(({ content }) => setBranchResponse(content))
      .catch(() => setBranchResponse(null))
      .finally(() => setLoadingBranch(false))
  }

  return (
    <div className="mt-2">
      <div className="text-sm text-gray-400 mb-1">
        Branches: {successCount} succeeded, {failCount} failed of {results.length}
      </div>
      <div className="space-y-1">
        {results.map((r) => {
          const icon = BRANCH_STATUS_ICON[r.status] ?? '?'
          const color = BRANCH_STATUS_COLOR[r.status] ?? 'text-gray-400'
          const isExpanded = expandedBranch === r.branch_id

          return (
            <div key={r.branch_id} className="border border-gray-800 rounded">
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-gray-900"
                onClick={() => handleToggle(r.branch_id)}
                aria-expanded={isExpanded}
              >
                <span className={`${color} shrink-0`}>{icon}</span>
                <span className="text-gray-300 truncate flex-1">{r.branch_id}</span>
                <span className={`text-xs ${color}`}>{r.status}</span>
                <span className="text-xs text-gray-600">{isExpanded ? '▾' : '▸'}</span>
              </button>
              {isExpanded && (
                <div className="px-2 pb-2 border-t border-gray-800">
                  {r.notes && (
                    <div className="text-xs text-gray-400 mt-1">{r.notes}</div>
                  )}
                  {r.error && (
                    <div className="text-xs text-red-400 mt-1">Error: {r.error}</div>
                  )}
                  {loadingBranch ? (
                    <div className="text-xs text-gray-500 italic mt-1">Loading response...</div>
                  ) : branchResponse ? (
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap bg-gray-800 rounded p-2 mt-1 max-h-40 overflow-y-auto">
                      {branchResponse}
                    </pre>
                  ) : branchResponse === null && !loadingBranch ? (
                    <div className="text-xs text-gray-500 italic mt-1">No response available</div>
                  ) : null}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
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
// Task 4c: Instance navigation control
// ---------------------------------------------------------------------------

interface InstanceNavProps {
  current: number   // 1-based
  total: number
  onPrev: () => void
  onNext: () => void
}

function InstanceNav({ current, total, onPrev, onNext }: InstanceNavProps) {
  if (total <= 1) return null
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <span>Instance {current} of {total}</span>
      <button
        className="px-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
        onClick={onPrev}
        disabled={current <= 1}
        aria-label="Previous instance"
        title="Previous instance"
      >◀</button>
      <button
        className="px-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
        onClick={onNext}
        disabled={current >= total}
        aria-label="Next instance"
        title="Next instance"
      >▶</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// NodeDetails component (with [Node | Files] tab bar)
// ---------------------------------------------------------------------------

export function NodeDetails() {
  const { selectedNodeId, selectedInstanceIndex, selectNodeWithInstance, activePipelineId, events } = usePipelineStore()
  const [responseContent, setResponseContent] = useState<string | null | undefined>(undefined)
  const [activeResponseTab, setActiveResponseTab] = useState<'response' | 'history'>('response')
  const [panelTab, setPanelTab] = useState<PanelTab>('node')
  const [branchResults, setBranchResults] = useState<BranchResult[] | null>(null)

  const pipelineEvents: PipelineEvent[] = activePipelineId
    ? (events.get(activePipelineId) ?? [])
    : []

  // Compute instance count for the selected node
  const instanceCount = selectedNodeId ? countInstances(pipelineEvents, selectedNodeId) : 0

  // Resolve the effective instance to display: selectedInstanceIndex ?? latest
  const effectiveInstance = selectedInstanceIndex ?? instanceCount

  // Fetch LLM response.md whenever a node is selected (UI-FEAT-012)
  // Always fetches the latest file (historical instances not available via API)
  useEffect(() => {
    if (!selectedNodeId || !activePipelineId) {
      setResponseContent(undefined)
      setBranchResults(null)
      return
    }

    setResponseContent(undefined) // show loading state
    setActiveResponseTab('response') // reset to response tab on node change
    setBranchResults(null) // reset branch results on node change

    getNodeResponse(activePipelineId, selectedNodeId)
      .then(({ content }) => setResponseContent(content))
      .catch(() => setResponseContent(null))
  }, [selectedNodeId, activePipelineId])

  // Fetch parallel branch results when viewing a fan-out node (UI-BUG-020)
  const isParallelNode = hasParallelEvents(pipelineEvents)

  useEffect(() => {
    if (!activePipelineId || !isParallelNode) {
      setBranchResults(null)
      return
    }
    getContext(activePipelineId)
      .then((ctx) => {
        const raw = ctx['parallel.results']
        if (typeof raw === 'string') {
          try {
            const parsed: BranchResult[] = JSON.parse(raw)
            setBranchResults(parsed)
          } catch {
            setBranchResults(null)
          }
        } else {
          setBranchResults(null)
        }
      })
      .catch(() => setBranchResults(null))
  }, [activePipelineId, isParallelNode])

  // Reset panelTab when pipeline changes (avoids stale Files tab across pipelines)
  useEffect(() => {
    setPanelTab('node')
  }, [activePipelineId])

  // Memoize callbacks for FileExplorer to prevent poll-interval resets on re-render
  const handleFetchTree = useCallback(() => {
    if (!activePipelineId) return Promise.resolve([])
    return getFiles(activePipelineId)
  }, [activePipelineId])

  const handleFetchFile = useCallback((path: string) => {
    if (!activePipelineId) return Promise.reject(new Error('No active pipeline'))
    return getFileContent(activePipelineId, path)
  }, [activePipelineId])

  // Task 4c: Instance navigation handlers
  const handlePrevInstance = useCallback(() => {
    if (!selectedNodeId || effectiveInstance <= 1) return
    selectNodeWithInstance(selectedNodeId, effectiveInstance - 1)
  }, [selectedNodeId, effectiveInstance, selectNodeWithInstance])

  const handleNextInstance = useCallback(() => {
    if (!selectedNodeId || effectiveInstance >= instanceCount) return
    selectNodeWithInstance(selectedNodeId, effectiveInstance + 1)
  }, [selectedNodeId, effectiveInstance, instanceCount, selectNodeWithInstance])

  // --- Tab bar ---
  const tabBar = activePipelineId ? (
    <div className="flex gap-1 px-4 pt-2 border-b border-gray-800 shrink-0" role="tablist" aria-label="Panel tabs">
      <button
        role="tab"
        aria-selected={panelTab === 'node'}
        onClick={() => setPanelTab('node')}
        className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
          panelTab === 'node'
            ? 'bg-gray-800 text-gray-200 border-b-2 border-blue-500'
            : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        Node
      </button>
      <button
        role="tab"
        aria-selected={panelTab === 'files'}
        onClick={() => setPanelTab('files')}
        className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
          panelTab === 'files'
            ? 'bg-gray-800 text-gray-200 border-b-2 border-blue-500'
            : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        Files
      </button>
    </div>
  ) : null

  // --- Files tab ---
  if (panelTab === 'files' && activePipelineId) {
    return (
      <div className="flex flex-col h-full">
        {tabBar}
        <FileExplorer
          key={activePipelineId}
          onFetchTree={handleFetchTree}
          onFetchFile={handleFetchFile}
          className="flex-1 min-h-0"
        />
      </div>
    )
  }

  // --- Node tab (original NodeDetails content) ---
  if (!selectedNodeId) {
    return (
      <div className="flex flex-col h-full">
        {tabBar}
        <div className="p-4 text-gray-500 text-sm">
          Click a node to see details.
        </div>
      </div>
    )
  }

  // Use instance-specific status/duration when a specific instance is selected
  const status = selectedInstanceIndex
    ? deriveStatusForInstance(pipelineEvents, selectedNodeId, selectedInstanceIndex)
    : deriveStatus(pipelineEvents, selectedNodeId)

  const durationMs = selectedInstanceIndex
    ? getDurationForInstance(pipelineEvents, selectedNodeId, selectedInstanceIndex)
    : getDuration(pipelineEvents, selectedNodeId)

  const errorMessage = getErrorMessage(pipelineEvents, selectedNodeId)

  return (
    <div className="flex flex-col h-full">
      {tabBar}
      <div className="p-4 flex flex-col gap-2 overflow-y-auto flex-1">
        {/* Task 4c: Node name + instance nav in header row */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-200">{selectedNodeId}</h2>
          {instanceCount > 1 && (
            <InstanceNav
              current={effectiveInstance}
              total={instanceCount}
              onPrev={handlePrevInstance}
              onNext={handleNextInstance}
            />
          )}
        </div>

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

        {/* Parallel branch results (UI-BUG-020) */}
        {branchResults && branchResults.length > 0 && activePipelineId && (
          <BranchResults results={branchResults} pipelineId={activePipelineId} />
        )}

        {/* LLM response section (UI-FEAT-012, UI-FEAT-015) */}
        {(status === 'completed' || status === 'running') && (
          <div className="mt-2">
            {responseContent === undefined ? (
              <div className="text-xs text-gray-500 italic">Loading...</div>
            ) : responseContent === null ? (
              <div className="text-xs text-gray-500 italic">Waiting for response...</div>
            ) : (
              <ResponseTabs content={responseContent} activeTab={activeResponseTab} onTabChange={setActiveResponseTab} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
