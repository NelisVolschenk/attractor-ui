import { useState } from 'react'
import { usePipelineStore } from '../store/pipelines'
import { usePipelineStatus } from '../hooks/usePipelineStatus'
import { usePipelineEvents } from '../hooks/usePipelineEvents'
import { NewPipelineDialog } from './NewPipelineDialog'
import { cancelPipeline } from '../api/client'
import type { PipelineStatus } from '../api/types'

const ID_DISPLAY_LENGTH = 12

function statusDotClass(
  status: PipelineStatus,
): 'bg-yellow-400' | 'bg-green-400' | 'bg-red-400' | 'bg-gray-400' {
  switch (status) {
    case 'running':
      return 'bg-yellow-400'
    case 'completed':
      return 'bg-green-400'
    case 'failed':
      return 'bg-red-400'
    case 'cancelled':
      return 'bg-gray-400'
  }
}

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false)

  const { pipelines, activePipelineId, setActivePipeline, setPipelineStatus } =
    usePipelineStore()

  usePipelineStatus()
  usePipelineEvents(activePipelineId)

  // Sort pipelines by started_at descending (newest first)
  const sortedPipelines = Array.from(pipelines.values()).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  )

  const handleCancel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await cancelPipeline(id)
      setPipelineStatus(id, 'cancelled')
    } catch {
      // Silently ignore — pipeline may have already finished
    }
  }

  return (
    <aside className="w-64 min-w-48 bg-gray-900 flex flex-col h-full text-white">
      <header className="p-4 border-b border-gray-700">
        <h1 className="text-lg font-bold">Attractor</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {sortedPipelines.length === 0 ? (
          <p className="text-gray-400 text-sm p-4">No pipelines yet.</p>
        ) : (
          <ul>
            {sortedPipelines.map((pipeline) => {
              const isActive = pipeline.id === activePipelineId
              return (
                <li key={pipeline.id}>
                  <button
                    className={`w-full text-left p-3 text-sm flex items-center gap-2 hover:bg-gray-800 transition-colors${
                      isActive ? ' bg-gray-800 border-l-2 border-l-blue-500' : ''
                    }`}
                    onClick={() => setActivePipeline(pipeline.id)}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(pipeline.status)}`}
                    ></span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-mono truncate">
                        {pipeline.id.slice(0, ID_DISPLAY_LENGTH)}
                      </span>
                      <span className="block text-gray-400 text-xs">{pipeline.status}</span>
                      {pipeline.current_node && (
                        <span className="block text-gray-500 text-xs truncate">
                          {pipeline.current_node}
                        </span>
                      )}
                    </span>
                    {pipeline.status === 'running' && (
                      <button
                        aria-label="Cancel pipeline"
                        className="ml-1 flex-shrink-0 text-gray-400 hover:text-red-400 transition-colors"
                        onClick={(e) => handleCancel(pipeline.id, e)}
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
                    )}
                  </button>
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
