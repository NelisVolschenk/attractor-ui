import { useState } from 'react'
import { usePipelineStore } from '../store/pipelines'
import { usePipelineStatus } from '../hooks/usePipelineStatus'
import { usePipelineEvents } from '../hooks/usePipelineEvents'
import { NewPipelineDialog } from './NewPipelineDialog'
import { cancelPipeline } from '../api/client'
import type { PipelineStatus, QuestionResponse } from '../api/types'

const ID_DISPLAY_LENGTH = 12

/** Display status includes 'waiting' for running pipelines with pending questions. */
type DisplayStatus = PipelineStatus | 'waiting'

/**
 * Derive the display status for a pipeline.
 *
 * UI-BUG-019: When a pipeline is "running" but has pending human-input
 * questions, display "waiting" instead so operators can see at a glance
 * which pipelines need attention.
 */
function deriveDisplayStatus(
  status: PipelineStatus,
  pendingQuestions: QuestionResponse[] | undefined,
): DisplayStatus {
  if (status === 'running' && pendingQuestions && pendingQuestions.length > 0) {
    return 'waiting'
  }
  return status
}

function statusDotClass(
  status: DisplayStatus,
): 'bg-yellow-400' | 'bg-green-400' | 'bg-red-400' | 'bg-gray-400' | 'bg-blue-400' {
  switch (status) {
    case 'running':
      return 'bg-yellow-400'
    case 'waiting':
      return 'bg-blue-400'
    case 'completed':
      return 'bg-green-400'
    case 'failed':
      return 'bg-red-400'
    case 'cancelled':
      return 'bg-gray-400'
    default:
      return 'bg-gray-400'
  }
}

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false)
  /** ID of the pipeline whose cancel is awaiting confirmation, or null. */
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null)

  const { pipelines, activePipelineId, setActivePipeline, setPipelineStatus, questions } =
    usePipelineStore()

  usePipelineStatus()
  usePipelineEvents(activePipelineId)

  // Sort pipelines by started_at descending (newest first)
  const sortedPipelines = Array.from(pipelines.values()).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )

  const handleCancelClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingCancelId(id)
  }

  const handleCancelConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirmingCancelId) return
    const id = confirmingCancelId
    setConfirmingCancelId(null)
    try {
      await cancelPipeline(id)
      setPipelineStatus(id, 'cancelled')
    } catch {
      // Silently ignore — pipeline may have already finished
    }
  }

  const handleCancelDeny = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmingCancelId(null)
  }

  return (
    // Task 1: match bg-gray-950 from Dashboard panel containers
    <aside className="w-64 min-w-48 bg-gray-950 flex flex-col h-full text-white">
      {/* Task 5: "Attractor" title removed — header element removed entirely */}

      <div className="flex-1 overflow-y-auto pt-2">
        {sortedPipelines.length === 0 ? (
          <p className="text-gray-400 text-sm p-4">No pipelines yet.</p>
        ) : (
          <ul>
            {sortedPipelines.map((pipeline) => {
              const isActive = pipeline.id === activePipelineId
              // UI-BUG-019: derive "waiting" status when running + has questions
              const displayStatus = deriveDisplayStatus(
                pipeline.status,
                questions.get(pipeline.id),
              )
              return (
                <li key={pipeline.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`w-full text-left p-3 text-sm flex items-center gap-2 hover:bg-gray-800 transition-colors cursor-pointer${
                      isActive ? ' bg-gray-800 border-l-2 border-l-blue-500' : ''
                    }`}
                    onClick={() => setActivePipeline(pipeline.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setActivePipeline(pipeline.id)
                    }}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(displayStatus)}`}
                    ></span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono truncate">
                        {pipeline.id.slice(0, ID_DISPLAY_LENGTH)}
                      </span>
                      <span className="block text-gray-400 text-xs">{displayStatus}</span>
                      {pipeline.current_node && (
                        <span className="block text-gray-500 text-xs truncate">
                          {pipeline.current_node}
                        </span>
                      )}
                    </span>
                    {pipeline.status === 'running' && confirmingCancelId === pipeline.id ? (
                      /* Inline confirmation prompt */
                      <span
                        className="flex items-center gap-1 ml-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs text-gray-300 whitespace-nowrap">
                          Cancel this pipeline?
                        </span>
                        <button
                          className="text-xs text-red-400 hover:text-red-300 font-medium"
                          onClick={handleCancelConfirm}
                        >
                          Yes
                        </button>
                        <button
                          className="text-xs text-gray-400 hover:text-gray-300 font-medium"
                          onClick={handleCancelDeny}
                        >
                          No
                        </button>
                      </span>
                    ) : pipeline.status === 'running' ? (
                      <button
                        aria-label="Cancel pipeline"
                        className="ml-1 flex-shrink-0 text-gray-400 hover:text-red-400 transition-colors"
                        onClick={(e) => handleCancelClick(pipeline.id, e)}
                      >
                        {/* Stop / square icon */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <rect x="4" y="4" width="12" height="12" rx="1" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="p-4 border-t border-gray-700">
        <button
          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded"
          onClick={() => setDialogOpen(true)}
        >
          + New Pipeline
        </button>
      </div>

      <NewPipelineDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </aside>
  )
}
