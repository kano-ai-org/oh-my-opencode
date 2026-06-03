import type { AgentOverrides } from "../../config"
import type { TopLevelTaskRef } from "../../features/boulder-state"

export type ModelInfo = { providerID: string; modelID: string; variant?: string }

export interface BackgroundTaskStatusProvider {
  getTasksByParentSession: (sessionID: string) => Array<{ status: string }>
}

export interface AtlasHookOptions {
  directory: string
  backgroundManager?: BackgroundTaskStatusProvider
  isContinuationStopped?: (sessionID: string) => boolean
  isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>
  agentOverrides?: AgentOverrides
  idleSettleMs?: number
  /** Enable auto-commit after each atomic task completion (default: true) */
  autoCommit?: boolean
}

export interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

export type TrackedTopLevelTaskRef = Pick<TopLevelTaskRef, "key" | "label" | "title">

export type PendingTaskRef =
  | { kind: "track"; task: TrackedTopLevelTaskRef }
  | { kind: "skip"; reason: "explicit_resume" }
  | { kind: "skip"; reason: "ambiguous_task_key"; task: TrackedTopLevelTaskRef }
  | { kind: "block"; reason: "task_id_mismatch"; task: TrackedTopLevelTaskRef; details: string }

export interface FinalWaveVerifierTimeoutRecord {
  count: number
  taskLabel?: string
  taskTitle?: string
  lastAt: number
  lastOutputSnippet?: string
}

export interface SubagentTaskFailureRecord {
  count: number
  kind: string
  reason: string
  taskLabel?: string
  taskTitle?: string
  sessionID?: string
  lastAt: number
  lastOutputSnippet?: string
}

export interface SessionState {
  lastEventWasAbortError?: boolean
  skipNextIdleAfterRuntimeErrorRetry?: boolean
  lastContinuationInjectedAt?: number
  isInjectingContinuation?: boolean
  promptFailureCount: number
  lastFailureAt?: number
  pendingRetryTimer?: ReturnType<typeof setTimeout>
  waitingForFinalWaveApproval?: boolean
  pendingFinalWaveTaskCount?: number
  approvedFinalWaveTaskCount?: number
  boulderCompletionNudgedAt?: Record<string, number>
  awaitingToolProgressAfterContinuation?: boolean
  iterationsSinceLastToolProgress?: number
  lastToolProgressAt?: number
  stalledContinuationReason?: string
  stalledContinuationPlanPath?: string
  /** The plan path the in-progress no-tool-progress counter is keyed to. Changes here reset the counter. */
  activeContinuationPlanPath?: string
  /** Plan path that owns finalWaveVerifierTimeouts. Prevents cross-plan timeout contamination. */
  finalWaveVerifierTimeoutPlanPath?: string
  /** Per final-wave task timeout accounting used to stop auto-continuation when verifier sessions cannot return verdicts. */
  finalWaveVerifierTimeouts?: Record<string, FinalWaveVerifierTimeoutRecord>
  /** Plan path that owns terminal subagent task failures. Prevents cross-plan failure contamination. */
  subagentTaskFailurePlanPath?: string
  /** Per top-level task terminal subagent failures used to stop quota-burning auto-continuation loops. */
  subagentTaskFailures?: Record<string, SubagentTaskFailureRecord>
}
