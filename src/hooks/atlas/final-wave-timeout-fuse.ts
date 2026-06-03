import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import type { FinalWaveVerifierTimeoutRecord, SessionState, TrackedTopLevelTaskRef } from "./types"

export const MAX_FINAL_WAVE_VERIFIER_TIMEOUTS_BEFORE_STOP = 1

const FINAL_WAVE_TASK_KEY_PREFIX = "final-wave:"
const VERDICT_PATTERN = /\bVERDICT\s*:/i
const TIMEOUT_OR_INTERRUPTION_PATTERN = /\b(?:timed?\s*out|timeout|interrupted|interruption|aborted|cancelled|canceled|stale|unavailable)\b/i
const VERIFIER_CONTEXT_PATTERN = /\b(?:verifier|verification|final\s+wave|review\s+agent|task\(\)|task[_\s-]*session|task[_\s-]*id|verdict|payload|session)\b/i
const EXPLICIT_FINAL_WAVE_TIMEOUT_PATTERNS = [
  /timed?\s*out\s+before\s+(?:returning|emitting)\s+(?:a\s+)?(?:final\s+)?verdict/i,
  /before\s+(?:returning|emitting)\s+(?:a\s+)?(?:final\s+)?verdict[^\n]*(?:timed?\s*out|timeout|interrupted)/i,
  /task[_\s-]*session\s+completion\/output\s+behavior/i,
  /formal\s+agent\s+verdicts?\s+(?:are\s+)?(?:still\s+)?missing/i,
]

const PERSISTENCE_FILE = "final-wave-verifier-timeouts.json"

type PersistedFinalWaveVerifierTimeoutPlanState = {
  planPath: string
  records: Record<string, FinalWaveVerifierTimeoutRecord>
  updatedAt: number
}

type PersistedFinalWaveVerifierTimeoutState = {
  schemaVersion: 1
  plans: Record<string, PersistedFinalWaveVerifierTimeoutPlanState>
}

export type FinalWaveVerifierTimeoutBlocker = {
  reason: string
  timeoutCount: number
  pendingFinalWaveTaskCount: number
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function getOutputSnippet(output: string): string {
  const normalized = normalizeWhitespace(output)
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized
}

function getPersistenceFilePath(directory: string): string {
  return join(directory, ".sisyphus", PERSISTENCE_FILE)
}

function getPlanPersistenceKey(planPath: string): string {
  return planPath.trim().replace(/\\/g, "/")
}

function createEmptyPersistedState(): PersistedFinalWaveVerifierTimeoutState {
  return {
    schemaVersion: 1,
    plans: {},
  }
}

function isPersistedRecord(value: unknown): value is FinalWaveVerifierTimeoutRecord {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as FinalWaveVerifierTimeoutRecord).count === "number"
    && typeof (value as FinalWaveVerifierTimeoutRecord).lastAt === "number"
}

function readPersistedState(directory: string): PersistedFinalWaveVerifierTimeoutState {
  const filePath = getPersistenceFilePath(directory)
  if (!existsSync(filePath)) {
    return createEmptyPersistedState()
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return createEmptyPersistedState()
    }

    const rawPlans = (parsed as { plans?: unknown }).plans
    if (!rawPlans || typeof rawPlans !== "object" || Array.isArray(rawPlans)) {
      return createEmptyPersistedState()
    }

    const plans: Record<string, PersistedFinalWaveVerifierTimeoutPlanState> = {}
    for (const [planKey, rawPlanState] of Object.entries(rawPlans)) {
      if (!rawPlanState || typeof rawPlanState !== "object" || Array.isArray(rawPlanState)) {
        continue
      }

      const planState = rawPlanState as PersistedFinalWaveVerifierTimeoutPlanState
      const rawRecords = planState.records
      if (!rawRecords || typeof rawRecords !== "object" || Array.isArray(rawRecords)) {
        continue
      }

      const records = Object.fromEntries(
        Object.entries(rawRecords)
          .filter(([, record]) => isPersistedRecord(record)),
      ) as Record<string, FinalWaveVerifierTimeoutRecord>

      plans[planKey] = {
        planPath: typeof planState.planPath === "string" ? planState.planPath : planKey,
        records,
        updatedAt: typeof planState.updatedAt === "number" ? planState.updatedAt : 0,
      }
    }

    return {
      schemaVersion: 1,
      plans,
    }
  } catch {
    return createEmptyPersistedState()
  }
}

function writePersistedState(directory: string, state: PersistedFinalWaveVerifierTimeoutState): void {
  const filePath = getPersistenceFilePath(directory)
  try {
    const parent = dirname(filePath)
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true })
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
  } catch {
    // Persistence is a guardrail, not a hard dependency for normal hook execution.
  }
}

export function readPersistedFinalWaveVerifierTimeouts(input: {
  directory?: string
  planPath: string
}): Record<string, FinalWaveVerifierTimeoutRecord> {
  if (!input.directory) {
    return {}
  }

  const state = readPersistedState(input.directory)
  const planKey = getPlanPersistenceKey(input.planPath)
  return state.plans[planKey]?.records ?? {}
}

function mergeTimeoutRecords(
  left: Record<string, FinalWaveVerifierTimeoutRecord> | undefined,
  right: Record<string, FinalWaveVerifierTimeoutRecord> | undefined,
): Record<string, FinalWaveVerifierTimeoutRecord> {
  const merged: Record<string, FinalWaveVerifierTimeoutRecord> = { ...(left ?? {}) }

  for (const [taskKey, rightRecord] of Object.entries(right ?? {})) {
    const leftRecord = merged[taskKey]
    if (!leftRecord) {
      merged[taskKey] = rightRecord
      continue
    }

    const newestRecord = rightRecord.lastAt >= leftRecord.lastAt ? rightRecord : leftRecord
    merged[taskKey] = {
      ...newestRecord,
      count: Math.max(leftRecord.count, rightRecord.count),
      lastAt: Math.max(leftRecord.lastAt, rightRecord.lastAt),
      lastOutputSnippet: newestRecord.lastOutputSnippet ?? leftRecord.lastOutputSnippet ?? rightRecord.lastOutputSnippet,
    }
  }

  return merged
}

function getMergedFinalWaveVerifierTimeouts(input: {
  sessionState: SessionState
  directory?: string
  planPath: string
}): Record<string, FinalWaveVerifierTimeoutRecord> {
  const inMemoryRecords = input.sessionState.finalWaveVerifierTimeoutPlanPath === undefined
    || input.sessionState.finalWaveVerifierTimeoutPlanPath === input.planPath
    ? input.sessionState.finalWaveVerifierTimeouts
    : undefined

  return mergeTimeoutRecords(
    inMemoryRecords,
    readPersistedFinalWaveVerifierTimeouts({
      directory: input.directory,
      planPath: input.planPath,
    }),
  )
}

function persistFinalWaveVerifierTimeouts(input: {
  directory?: string
  planPath?: string
  records: Record<string, FinalWaveVerifierTimeoutRecord>
  now: number
}): void {
  if (!input.directory || !input.planPath) {
    return
  }

  const state = readPersistedState(input.directory)
  const planKey = getPlanPersistenceKey(input.planPath)
  const existingPlanState = state.plans[planKey]
  state.plans[planKey] = {
    planPath: input.planPath,
    records: mergeTimeoutRecords(existingPlanState?.records, input.records),
    updatedAt: input.now,
  }
  writePersistedState(input.directory, state)
}

export function clearPersistedFinalWaveVerifierTimeouts(input: {
  directory: string
  planPath: string
}): void {
  const state = readPersistedState(input.directory)
  const planKey = getPlanPersistenceKey(input.planPath)
  if (!state.plans[planKey]) {
    return
  }

  delete state.plans[planKey]
  writePersistedState(input.directory, state)
}

export function isFinalWaveTask(task: TrackedTopLevelTaskRef | null | undefined): boolean {
  return !!task?.key && task.key.startsWith(FINAL_WAVE_TASK_KEY_PREFIX)
}

export function isFinalWaveVerifierTimeoutOutput(output: string): boolean {
  if (!output || VERDICT_PATTERN.test(output)) {
    return false
  }

  if (EXPLICIT_FINAL_WAVE_TIMEOUT_PATTERNS.some((pattern) => pattern.test(output))) {
    return true
  }

  return TIMEOUT_OR_INTERRUPTION_PATTERN.test(output) && VERIFIER_CONTEXT_PATTERN.test(output)
}

export function recordFinalWaveVerifierTimeout(input: {
  sessionState: SessionState
  task: TrackedTopLevelTaskRef
  output: string
  now?: number
  directory?: string
  planPath?: string
}): FinalWaveVerifierTimeoutRecord {
  const { sessionState, task, output, now = Date.now() } = input
  if (input.planPath && sessionState.finalWaveVerifierTimeoutPlanPath !== input.planPath) {
    sessionState.finalWaveVerifierTimeoutPlanPath = input.planPath
    sessionState.finalWaveVerifierTimeouts = undefined
  }

  const existingRecords = input.planPath
    ? getMergedFinalWaveVerifierTimeouts({
        sessionState,
        directory: input.directory,
        planPath: input.planPath,
      })
    : sessionState.finalWaveVerifierTimeouts
  const existing = existingRecords?.[task.key]
  const nextRecord: FinalWaveVerifierTimeoutRecord = {
    count: (existing?.count ?? 0) + 1,
    taskLabel: task.label,
    taskTitle: task.title,
    lastAt: now,
    lastOutputSnippet: getOutputSnippet(output),
  }
  const nextRecords = {
    ...(existingRecords ?? {}),
    [task.key]: nextRecord,
  }

  sessionState.finalWaveVerifierTimeouts = nextRecords

  persistFinalWaveVerifierTimeouts({
    directory: input.directory,
    planPath: input.planPath,
    records: nextRecords,
    now,
  })

  return nextRecord
}

export function getFinalWaveVerifierTimeoutCount(input: {
  sessionState: SessionState
  directory?: string
  planPath?: string
}): number {
  const records = input.planPath
    ? getMergedFinalWaveVerifierTimeouts({
        sessionState: input.sessionState,
        directory: input.directory,
        planPath: input.planPath,
      })
    : input.sessionState.finalWaveVerifierTimeouts ?? {}

  return Object.values(records)
    .reduce((total, record) => total + Math.max(0, record.count), 0)
}

export function getFinalWaveVerifierTimeoutBlocker(input: {
  planPath: string
  sessionState: SessionState
  directory?: string
}): FinalWaveVerifierTimeoutBlocker | null {
  const planState = readFinalWavePlanState(input.planPath)
  if (!planState) {
    return null
  }

  if (planState.pendingImplementationTaskCount > 0 || planState.pendingFinalWaveTaskCount === 0) {
    return null
  }

  const timeoutCount = getFinalWaveVerifierTimeoutCount({
    sessionState: input.sessionState,
    directory: input.directory,
    planPath: input.planPath,
  })
  if (timeoutCount < MAX_FINAL_WAVE_VERIFIER_TIMEOUTS_BEFORE_STOP) {
    return null
  }

  return {
    timeoutCount,
    pendingFinalWaveTaskCount: planState.pendingFinalWaveTaskCount,
    reason: `Final Wave verification is unavailable: ${timeoutCount} verifier task/session timeout${timeoutCount === 1 ? "" : "s"} recorded while ${planState.pendingFinalWaveTaskCount} final-wave task${planState.pendingFinalWaveTaskCount === 1 ? "" : "s"} remain and no implementation tasks remain. Auto-continuation must stop until a real user explicitly retries or performs manual verification.`,
  }
}

export function markFinalWaveVerifierContinuationBlocked(input: {
  sessionState: SessionState
  planName: string
  planPath: string
  blocker: FinalWaveVerifierTimeoutBlocker
}): void {
  input.sessionState.stalledContinuationReason = `Boulder continuation stopped for plan "${input.planName}": ${input.blocker.reason}`
  input.sessionState.stalledContinuationPlanPath = input.planPath
  input.sessionState.waitingForFinalWaveApproval = false
}

export function buildFinalWaveVerifierTimeoutReminder(input: {
  planName: string
  blocker: FinalWaveVerifierTimeoutBlocker
}): string {
  return [
    "FINAL VERIFICATION UNAVAILABLE",
    "",
    `Plan: ${input.planName}`,
    `Pending final-wave tasks: ${input.blocker.pendingFinalWaveTaskCount}`,
    `Recorded verifier timeouts: ${input.blocker.timeoutCount}`,
    "",
    input.blocker.reason,
    "",
    "Do not relaunch or resume Final Wave verifier agents from auto-continuation.",
    "Do not inject another BOULDER CONTINUATION for these verifier-only remaining tasks.",
    "Document the blocker and require explicit human approval or manual verification before retrying.",
  ].join("\n")
}
