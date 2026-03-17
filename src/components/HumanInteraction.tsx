import { useState, useEffect } from 'react'
import type { QuestionResponse } from '../api/types'
import { submitAnswer, getNodeResponse } from '../api/client'
import { usePipelineStore } from '../store/pipelines'
import { extractLastResponse } from '../utils/responseParser'

// ---------------------------------------------------------------------------
// PreviousNodeResponse — fetch and display the last completed node's LLM output
// Shows "Response" (extracted) / "Full History" tabs when content has separators
// (UI-FEAT-014, UI-FEAT-015)
// ---------------------------------------------------------------------------

interface PreviousNodeResponseProps {
  pipelineId: string
  nodeId: string
}

function PreviousNodeResponse({ pipelineId, nodeId }: PreviousNodeResponseProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'response' | 'history'>('response')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setContent(null)
    setActiveTab('response')
    getNodeResponse(pipelineId, nodeId)
      .then((result) => {
        if (!cancelled) {
          setContent(result.content)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [pipelineId, nodeId])

  if (loading) {
    return (
      <div className="text-xs text-gray-500 italic mb-2">Loading previous response...</div>
    )
  }
  if (!content) return null

  const extracted = extractLastResponse(content)
  const hasSeparator = extracted !== content.trim()
  const displayContent = activeTab === 'response' ? extracted : content

  return (
    <div className="mb-2">
      {hasSeparator && (
        <div className="flex gap-1 mb-1" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'response'}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'response'
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-500 hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('response')}
          >
            Response
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'history'}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'history'
                ? 'bg-blue-700 text-white'
                : 'bg-gray-800 text-gray-500 hover:text-gray-200'
            }`}
            onClick={() => setActiveTab('history')}
          >
            Full History
          </button>
        </div>
      )}
      <div className="p-2 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
        {displayContent}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// QuestionCard sub-component
// ---------------------------------------------------------------------------

interface QuestionCardProps {
  pipelineId: string
  question: QuestionResponse
  lastCompletedNode: string | null
  onRemove: (pipelineId: string, qid: string) => void
  isTerminal?: boolean
}

function QuestionCard({ pipelineId, question, lastCompletedNode, onRemove, isTerminal = false }: QuestionCardProps) {
  const [freeTextValue, setFreeTextValue] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (answer: string) => {
    setError(null)
    try {
      await submitAnswer(pipelineId, question.qid, answer)
      onRemove(pipelineId, question.qid)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    }
  }

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <div className="rounded-md border border-gray-700 bg-gray-900 p-3 space-y-2">
      <p className="text-sm text-gray-200">{question.text}</p>

      {/* Terminal state notice — pipeline no longer accepts answers */}
      {isTerminal && (
        <p className="text-xs text-gray-500 italic">Pipeline is no longer running — answers cannot be submitted.</p>
      )}

      {question.question_type === 'confirmation' && (
        <div className="flex gap-2">
          <button
            disabled={isTerminal}
            className="px-3 py-1 text-sm rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleSubmit('yes')}
          >
            Yes
          </button>
          <button
            disabled={isTerminal}
            className="px-3 py-1 text-sm rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleSubmit('no')}
          >
            No
          </button>
        </div>
      )}

      {question.question_type === 'single_select' && (
        <div className="flex flex-wrap gap-2">
          {question.options.map((opt) => (
            <button
              key={opt.key}
              disabled={isTerminal}
              className="px-3 py-1 text-sm rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleSubmit(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {question.question_type === 'multi_select' && (
        <div className="space-y-1">
          {question.options.map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                aria-label={opt.label}
                checked={selectedKeys.has(opt.key)}
                onChange={() => !isTerminal && toggleKey(opt.key)}
                disabled={isTerminal}
                className="accent-blue-500"
              />
              {opt.label}
            </label>
          ))}
          <button
            disabled={isTerminal}
            className="mt-2 px-3 py-1 text-sm rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => handleSubmit(Array.from(selectedKeys).join(','))}
          >
            Submit
          </button>
        </div>
      )}

      {question.question_type === 'free_text' && (
        <div className="space-y-2">
          {/* Show previous node's LLM response as context (UI-FEAT-014) */}
          {lastCompletedNode && (
            <PreviousNodeResponse pipelineId={pipelineId} nodeId={lastCompletedNode} />
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={freeTextValue}
              disabled={isTerminal}
              onChange={(e) => setFreeTextValue(e.target.value)}
              className="flex-1 px-2 py-1 text-sm rounded bg-gray-800 border border-gray-600 text-gray-200 focus:outline-none focus:border-blue-500 disabled:opacity-40"
            />
            <button
              disabled={isTerminal}
              className="px-3 py-1 text-sm rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => handleSubmit(freeTextValue.trim())}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// HumanInteraction component
// ---------------------------------------------------------------------------

export function HumanInteraction() {
  const { activePipelineId, questions, removeQuestion, pipelines } = usePipelineStore()

  const pendingQuestions: QuestionResponse[] = activePipelineId
    ? (questions.get(activePipelineId) ?? [])
    : []

  const hasPending = pendingQuestions.length > 0

  // Get the last completed node for the active pipeline (UI-FEAT-014)
  const activePipeline = activePipelineId ? pipelines.get(activePipelineId) : undefined
  const completedNodes = activePipeline?.completed_nodes ?? []
  const lastCompletedNode = completedNodes.length > 0
    ? completedNodes[completedNodes.length - 1]
    : null

  // UI-BUG-018: disable submit when pipeline is in a terminal state
  const isTerminal = activePipeline
    ? ['cancelled', 'completed', 'failed'].includes(activePipeline.status)
    : false

  return (
    <div
      className={`flex flex-col h-full bg-gray-950 overflow-hidden${hasPending ? ' border-2 border-orange-500 animate-pulse' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-sm font-medium text-gray-200">Questions</span>
        <span className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5">
          {pendingQuestions.length}
        </span>
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {pendingQuestions.length === 0 ? (
          <div className="text-gray-500 text-sm">No pending questions.</div>
        ) : (
          pendingQuestions.map((q) => (
            <QuestionCard
              key={q.qid}
              pipelineId={activePipelineId!}
              question={q}
              lastCompletedNode={lastCompletedNode}
              onRemove={removeQuestion}
              isTerminal={isTerminal}
            />
          ))
        )}
      </div>
    </div>
  )
}
