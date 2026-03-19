/**
 * TypeScript types mirroring attractor-server API response/request shapes.
 *
 * All field names use snake_case to match Rust's serde serialization defaults.
 * Duration fields use DurationMs (`{ __duration_ms: number }`) matching
 * the custom `duration_millis_serde` helper in the attractor crate.
 */

// ---------------------------------------------------------------------------
// Sentinel — imported as a value to ensure module resolution in tests
// ---------------------------------------------------------------------------
export const API_TYPES_SCHEMA_VERSION = '1' as const

// ---------------------------------------------------------------------------
// Pipeline status
// ---------------------------------------------------------------------------
export type PipelineStatus = 'running' | 'completed' | 'failed' | 'cancelled'

// ---------------------------------------------------------------------------
// Pipeline list and detail responses
// ---------------------------------------------------------------------------

/** One entry returned by GET /pipelines (list all) */
export interface PipelineSummary {
  id: string
  status: PipelineStatus
  started_at: string
  completed_nodes: string[]
  current_node: string | null
}

/** Response body from GET /pipelines/{id} */
export interface PipelineStatusResponse {
  id: string
  status: PipelineStatus
  started_at: string
  completed_nodes: string[]
  current_node: string | null
}

// ---------------------------------------------------------------------------
// Pipeline create / cancel
// ---------------------------------------------------------------------------

/** POST /pipelines — request body */
export interface CreatePipelineRequest {
  dot: string
  context: Record<string, unknown>
}

/** POST /pipelines — response body */
export interface CreatePipelineResponse {
  id: string
  status: PipelineStatus
}

/** POST /pipelines/{id}/cancel — response body */
export interface CancelResponse {
  status: PipelineStatus
}

// ---------------------------------------------------------------------------
// Question types
// ---------------------------------------------------------------------------

/** Matches attractor::QuestionType (serde snake_case) */
export type QuestionType = 'single_select' | 'multi_select' | 'free_text' | 'confirmation'

/** One selectable option in a multi-select or single-select question */
export interface QuestionOption {
  key: string
  label: string
}

/** Single pending question item (as returned by GET /pipelines/{id}/questions) */
export interface QuestionResponse {
  qid: string
  text: string
  question_type: QuestionType
  options: QuestionOption[]
  created_at: string
  /** ATR-BUG-005: Question metadata from the server (includes last_codergen_node). */
  metadata?: Record<string, string>
}

/** Response body from GET /pipelines/{id}/questions */
export interface QuestionsResponse {
  questions: QuestionResponse[]
}

// ---------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------

/** POST /pipelines/{id}/questions/{qid}/answer — request body */
export interface AnswerRequest {
  answer: string
}

/** POST /pipelines/{id}/questions/{qid}/answer — response body */
export interface AnswerResponse {
  status: string
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/** Response body from GET /pipelines/{id}/graph */
export interface GraphResponse {
  dot: string
  format: string
}

/** Response body from GET /pipelines/{id}/nodes/{node_id}/response */
export interface NodeResponseResult {
  /** LLM response.md content, or null if not yet written */
  content: string | null
}

// ---------------------------------------------------------------------------
// File explorer (FE-001 / FE-005)
// ---------------------------------------------------------------------------

/** A node in the directory tree returned by GET /pipelines/{id}/files */
export interface FileNode {
  /** File or directory name (e.g. "plan.md") */
  name: string
  /** Path relative to working directory (e.g. "docs/plans/plan.md") */
  path: string
  /** "file" or "directory" */
  type: 'file' | 'directory'
  /** File size in bytes (files only) */
  size?: number
  /** ISO 8601 last-modified timestamp */
  modified_at?: string
  /** Child entries (directories only) */
  children?: FileNode[]
}

// ---------------------------------------------------------------------------
// Server error envelope  { "error": { code, message, status, diagnostics? } }
// ---------------------------------------------------------------------------
export interface ServerError {
  error: {
    code: string
    message: string
    status: number
    diagnostics?: string[]
  }
}

// ---------------------------------------------------------------------------
// Duration serialised via duration_millis_serde in the attractor crate
// ---------------------------------------------------------------------------
export interface DurationMs {
  __duration_ms: number
}

// ---------------------------------------------------------------------------
// PipelineEvent — discriminated union on the "event" field
// Matches: #[serde(tag = "event", rename_all = "snake_case")]
// ---------------------------------------------------------------------------

export interface PipelineStartedEvent {
  event: 'pipeline_started'
  name: string
  id: string
}

export interface PipelineCompletedEvent {
  event: 'pipeline_completed'
  duration: DurationMs
  artifact_count: number
}

export interface PipelineFailedEvent {
  event: 'pipeline_failed'
  error: string
  duration: DurationMs
}

export interface StageStartedEvent {
  event: 'stage_started'
  name: string
  index: number
}

export interface StageCompletedEvent {
  event: 'stage_completed'
  name: string
  index: number
  duration: DurationMs
}

export interface StageFailedEvent {
  event: 'stage_failed'
  name: string
  index: number
  error: string
  will_retry: boolean
}

export interface StageRetryingEvent {
  event: 'stage_retrying'
  name: string
  index: number
  attempt: number
  delay: DurationMs
}

export interface ParallelStartedEvent {
  event: 'parallel_started'
  branch_count: number
}

export interface ParallelBranchStartedEvent {
  event: 'parallel_branch_started'
  branch: string
  index: number
}

export interface ParallelBranchCompletedEvent {
  event: 'parallel_branch_completed'
  branch: string
  index: number
  duration: DurationMs
  success: boolean
  /** Error message when the branch failed (ATR-BUG-008). Absent for successful branches. */
  error?: string
}

export interface ParallelCompletedEvent {
  event: 'parallel_completed'
  duration: DurationMs
  success_count: number
  failure_count: number
}

export interface InterviewStartedEvent {
  event: 'interview_started'
  question: string
  stage: string
}

export interface InterviewCompletedEvent {
  event: 'interview_completed'
  question: string
  answer: string
  duration: DurationMs
}

export interface InterviewTimeoutEvent {
  event: 'interview_timeout'
  question: string
  stage: string
  duration: DurationMs
}

export interface CheckpointSavedEvent {
  event: 'checkpoint_saved'
  node_id: string
}

// ---------------------------------------------------------------------------
// BranchResult — mirrors attractor::handler::fan_in::BranchResult (ATR-BUG-008)
// Stored as JSON string in context["parallel.results"] by ParallelHandler.
// ---------------------------------------------------------------------------

export type BranchStatus = 'success' | 'partial_success' | 'retry' | 'skipped' | 'fail'

/** A single parallel branch result from context["parallel.results"]. */
export interface BranchResult {
  branch_id: string
  status: BranchStatus
  notes: string
  /** Error message when the branch failed. Absent for successful branches. */
  error?: string
}

/** All 15 pipeline event types, discriminated on the `event` field */
export type PipelineEvent =
  | PipelineStartedEvent
  | PipelineCompletedEvent
  | PipelineFailedEvent
  | StageStartedEvent
  | StageCompletedEvent
  | StageFailedEvent
  | StageRetryingEvent
  | ParallelStartedEvent
  | ParallelBranchStartedEvent
  | ParallelBranchCompletedEvent
  | ParallelCompletedEvent
  | InterviewStartedEvent
  | InterviewCompletedEvent
  | InterviewTimeoutEvent
  | CheckpointSavedEvent
