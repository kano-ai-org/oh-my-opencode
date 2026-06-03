import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { SessionState, SubagentTaskFailureRecord, TrackedTopLevelTaskRef } from "./types"

export const MAX_SUBAGENT_TASK_FAILURES_BEFORE_STOP = 1

const PERSISTENCE_FILE = "subagent-task-failures.json"
const CHECKED_CHECKBOX_PATTERN = /^(\s*)[-*]\s*\[[xX]\]\s*(.+)$/
const TODO_TASK_PATTERN = /^(\d+)\.\s+(.+)$/
const FINAL_WAVE_TASK_PATTERN = /^(F\d+)\.\s+(.+)$/i
const TODO_HEADING_PATTERN = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING_PATTERN = /^##\s+Final Verification Wave\b/i
const SECOND_LEVEL_HEADING_PATTERN = /^##\s+/

export type SubagentTaskFailureKind =
  | "poll_timeout"
  | "empty_completion"
  | "missing_required_skills"
  | "task_id_mismatch"
  | "session_output_unavailable"

export type SubagentTaskFailureClassification = {
  kind: SubagentTaskFailureKind
  reason: string
  sessionID?: string
}

export type SubagentTaskFailureBlocker = {
  reason: string
  failureCount: number
  failedTaskCount: number
  records: Record<string, SubagentTaskFailureRecord>
}

type PersistedSubagentTaskFailurePlanState = {
  planPath: string
  records: Record<string, SubagentTaskFailureRecord>
  updatedAt: number
}

type PersistedSubagentTaskFailureState = {
  schemaVersion: 1
  plans: Record<string, PersistedSubagentTaskFailurePlanState>
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function getOutputSnippet(output: string): string {
  const normalized = normalizeWhitespace(output)
  return normalized.length > 300 ? `${normalized.slice(0, 297)}...` : normalized
}

function getPersistenceFilePath(directory: string): string {
  return join(directory, ".sisyphus", PERSISTENCE_FILE)
}

function getPlanPersistenceKey(planPath: string): string {
  return planPath.trim().replace(/\\/g, "/")
}

function createEmptyPersistedState(): PersistedSubagentTaskFailureState {
  return { schemaVersion: 1, plans: {} }
}

function isPersistedRecord(value: unknown): value is SubagentTaskFailureRecord {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as SubagentTaskFailureRecord).count === "number"
    && typeof (value as SubagentTaskFailureRecord).lastAt === "number"
    && typeof (value as SubagentTaskFailureRecord).kind === "string"
}

function readPersistedState(directory: string): PersistedSubagentTaskFailureState {
  const filePath = getPersistenceFilePath(directory)
  if (!existsSync(filePath)) return createEmptyPersistedState()

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createEmptyPersistedState()
    const rawPlans = (parsed as { plans?: unknown }).plans
    if (!rawPlans || typeof rawPlans !== "object" || Array.isArray(rawPlans)) return createEmptyPersistedState()

    const plans: Record<string, PersistedSubagentTaskFailurePlanState> = {}
    for (const [planKey, rawPlanState] of Object.entries(rawPlans)) {
      if (!rawPlanState || typeof rawPlanState !== "object" || Array.isArray(rawPlanState)) continue
      const planState = rawPlanState as PersistedSubagentTaskFailurePlanState
      const rawRecords = planState.records
      if (!rawRecords || typeof rawRecords !== "object" || Array.isArray(rawRecords)) continue

      const records = Object.fromEntries(
        Object.entries(rawRecords).filter(([, record]) => isPersistedRecord(record)),
      ) as Record<string, SubagentTaskFailureRecord>

      plans[planKey] = {
        planPath: typeof planState.planPath === "string" ? planState.planPath : planKey,
        records,
        updatedAt: typeof planState.updatedAt === "number" ? planState.updatedAt : 0,
      }
    }

    return { schemaVersion: 1, plans }
  } catch {
    return createEmptyPersistedState()
  }
}

function writePersistedState(directory: string, state: PersistedSubagentTaskFailureState): void {
  const filePath = getPersistenceFilePath(directory)
  try {
    const parent = dirname(filePath)
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8")
  } catch {
    // Guardrail persistence must not break normal hook execution.
  }
}

export function readPersistedSubagentTaskFailures(input: {
  directory?: string
  planPath: string
}): Record<string, SubagentTaskFailureRecord> {
  if (!input.directory) return {}
  const state = readPersistedState(input.directory)
  return state.plans[getPlanPersistenceKey(input.planPath)]?.records ?? {}
}

function mergeRecords(
  left: Record<string, SubagentTaskFailureRecord> | undefined,
  right: Record<string, SubagentTaskFailureRecord> | undefined,
): Record<string, SubagentTaskFailureRecord> {
  const merged: Record<string, SubagentTaskFailureRecord> = { ...(left ?? {}) }
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

function getMergedSubagentTaskFailures(input: {
  sessionState: SessionState
  directory?: string
  planPath: string
}): Record<string, SubagentTaskFailureRecord> {
  const inMemoryRecords = input.sessionState.subagentTaskFailurePlanPath === undefined
    || input.sessionState.subagentTaskFailurePlanPath === input.planPath
    ? input.sessionState.subagentTaskFailures
    : undefined

  return mergeRecords(
    inMemoryRecords,
    readPersistedSubagentTaskFailures({ directory: input.directory, planPath: input.planPath }),
  )
}

function persistSubagentTaskFailures(input: {
  directory?: string
  planPath?: string
  records: Record<string, SubagentTaskFailureRecord>
  now: number
}): void {
  if (!input.directory || !input.planPath) return
  const state = readPersistedState(input.directory)
  const planKey = getPlanPersistenceKey(input.planPath)
  const existing = state.plans[planKey]
  state.plans[planKey] = {
    planPath: input.planPath,
    records: mergeRecords(existing?.records, input.records),
    updatedAt: input.now,
  }
  writePersistedState(input.directory, state)
}

export function clearPersistedSubagentTaskFailures(input: {
  directory: string
  planPath: string
}): void {
  const state = readPersistedState(input.directory)
  const planKey = getPlanPersistenceKey(input.planPath)
  if (!state.plans[planKey]) return
  delete state.plans[planKey]
  writePersistedState(input.directory, state)
}

function taskKeyFromCheckedLine(section: "todo" | "final-wave", lineBody: string): string | null {
  const pattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
  const match = lineBody.match(pattern)
  if (!match?.[1]) return null
  return `${section}:${match[1].toLowerCase()}`
}

function readCheckedTaskKeys(planPath: string): Set<string> {
  if (!existsSync(planPath)) return new Set()
  try {
    const lines = readFileSync(planPath, "utf-8").split(/\r?\n/)
    const checked = new Set<string>()
    let section: "todo" | "final-wave" | "other" = "other"
    for (const line of lines) {
      if (SECOND_LEVEL_HEADING_PATTERN.test(line)) {
        section = TODO_HEADING_PATTERN.test(line)
          ? "todo"
          : FINAL_VERIFICATION_HEADING_PATTERN.test(line)
            ? "final-wave"
            : "other"
        continue
      }

      if (section !== "todo" && section !== "final-wave") continue
      const checkedMatch = line.match(CHECKED_CHECKBOX_PATTERN)
      if (!checkedMatch || checkedMatch[1].length > 0) continue
      const taskKey = taskKeyFromCheckedLine(section, checkedMatch[2].trim())
      if (taskKey) checked.add(taskKey)
    }
    return checked
  } catch {
    return new Set()
  }
}

export function classifySubagentTaskFailureOutput(output: string): SubagentTaskFailureClassification | null {
  const text = output.trim()
  if (!text) {
    return {
      kind: "empty_completion",
      reason: "Subagent task returned an empty output.",
    }
  }

  const pollTimeoutMatch = text.match(/Poll timeout reached after\s+\d+ms\s+for session\s+([A-Za-z0-9_-]+)/i)
  if (pollTimeoutMatch?.[1]) {
    return {
      kind: "poll_timeout",
      sessionID: pollTimeoutMatch[1],
      reason: `Subagent task polling timed out before a terminal output was available for ${pollTimeoutMatch[1]}.`,
    }
  }

  if (/\[Task Empty Response Warning\]/i.test(text) || /Task invocation completed but returned no response/i.test(text)) {
    return {
      kind: "empty_completion",
      reason: "Subagent task completed with no response text.",
    }
  }

  if (/<task_result>\s*<\/task_result>/i.test(text)) {
    return {
      kind: "empty_completion",
      reason: "Subagent task emitted an empty task_result payload.",
    }
  }

  if (/\bSUBAGENT_EMPTY_COMPLETION\b/i.test(text) || (/finish\s*[:=]\s*unknown/i.test(text) && /tokens?\s*[:=]\s*0/i.test(text))) {
    return {
      kind: "empty_completion",
      reason: "Subagent task reached an unknown/zero-token completion without useful output.",
    }
  }

  if (/\b(?:Skills?|Agents?)\s+not\s+found\b/i.test(text) || /\bUnknown agent type\b/i.test(text) || /\bAgent not found\b/i.test(text)) {
    return {
      kind: "missing_required_skills",
      reason: "Subagent task could not start because required skills/agents were missing.",
    }
  }

  if (/\bTASK_ID_MISMATCH\b/i.test(text)) {
    return {
      kind: "task_id_mismatch",
      reason: "Subagent resume request targeted a task/session that does not match the active plan task.",
    }
  }

  if (/task[_\s-]*session\s+(?:completion|output)\s+(?:unavailable|missing|failed)/i.test(text)) {
    return {
      kind: "session_output_unavailable",
      reason: "Subagent task session output was unavailable.",
    }
  }

  return null
}

export function recordSubagentTaskFailure(input: {
  sessionState: SessionState
  task: TrackedTopLevelTaskRef
  classification: SubagentTaskFailureClassification
  output: string
  now?: number
  directory?: string
  planPath?: string
}): SubagentTaskFailureRecord {
  const { sessionState, task, classification, output, now = Date.now() } = input
  if (input.planPath && sessionState.subagentTaskFailurePlanPath !== input.planPath) {
    sessionState.subagentTaskFailurePlanPath = input.planPath
    sessionState.subagentTaskFailures = undefined
  }

  const existingRecords = input.planPath
    ? getMergedSubagentTaskFailures({ sessionState, directory: input.directory, planPath: input.planPath })
    : sessionState.subagentTaskFailures
  const existing = existingRecords?.[task.key]
  const nextRecord: SubagentTaskFailureRecord = {
    count: (existing?.count ?? 0) + 1,
    kind: classification.kind,
    reason: classification.reason,
    taskLabel: task.label,
    taskTitle: task.title,
    sessionID: classification.sessionID,
    lastAt: now,
    lastOutputSnippet: getOutputSnippet(output),
  }
  const nextRecords = { ...(existingRecords ?? {}), [task.key]: nextRecord }
  sessionState.subagentTaskFailures = nextRecords

  persistSubagentTaskFailures({
    directory: input.directory,
    planPath: input.planPath,
    records: nextRecords,
    now,
  })

  return nextRecord
}

export function getSubagentTaskFailureBlocker(input: {
  planPath: string
  sessionState: SessionState
  directory?: string
}): SubagentTaskFailureBlocker | null {
  const records = getMergedSubagentTaskFailures({
    sessionState: input.sessionState,
    directory: input.directory,
    planPath: input.planPath,
  })
  const checkedTaskKeys = readCheckedTaskKeys(input.planPath)
  const activeRecords = Object.fromEntries(
    Object.entries(records).filter(([taskKey, record]) => !checkedTaskKeys.has(taskKey) && record.count >= MAX_SUBAGENT_TASK_FAILURES_BEFORE_STOP),
  ) as Record<string, SubagentTaskFailureRecord>
  const failureCount = Object.values(activeRecords).reduce((total, record) => total + Math.max(0, record.count), 0)
  if (failureCount <= 0) return null

  const failedTasks = Object.values(activeRecords)
    .map((record) => `${record.taskLabel ?? "?"} ${record.taskTitle ?? "(untitled)"} [${record.kind}]`)
    .join(", ")
  return {
    records: activeRecords,
    failureCount,
    failedTaskCount: Object.keys(activeRecords).length,
    reason: `Auto-continuation stopped because ${Object.keys(activeRecords).length} active top-level task(s) hit terminal subagent failure(s): ${failedTasks}. Require real user input before retrying.`,
  }
}

export function markSubagentTaskFailureContinuationBlocked(input: {
  sessionState: SessionState
  planName: string
  planPath: string
  blocker: SubagentTaskFailureBlocker
}): void {
  input.sessionState.stalledContinuationReason = `Boulder continuation stopped for plan "${input.planName}": ${input.blocker.reason}`
  input.sessionState.stalledContinuationPlanPath = input.planPath
  input.sessionState.waitingForFinalWaveApproval = false
}

export function buildSubagentTaskFailureReminder(input: {
  planName: string
  blocker: SubagentTaskFailureBlocker
}): string {
  const records = Object.entries(input.blocker.records).map(([taskKey, record]) => {
    const session = record.sessionID ? ` session=${record.sessionID}` : ""
    const snippet = record.lastOutputSnippet ? `\n  Last output: ${record.lastOutputSnippet}` : ""
    return `- ${taskKey}: ${record.taskLabel ?? "?"} ${record.taskTitle ?? "(untitled)"} — ${record.kind} x${record.count}${session}${snippet}`
  })
  return [
    "SUBAGENT TASK BLOCKED",
    "",
    `Plan: ${input.planName}`,
    `Failed active tasks: ${input.blocker.failedTaskCount}`,
    `Recorded terminal failures: ${input.blocker.failureCount}`,
    "",
    input.blocker.reason,
    "",
    ...records,
    "",
    "Do not relaunch or resume this subagent task from auto-continuation.",
    "Do not inject another BOULDER/TODO continuation for this blocked task.",
    "A real user must explicitly fix the blocker, correct the task_id/skill configuration, or request a manual retry.",
  ].join("\n")
}
