import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { isRecord } from "./error-classifier"
import type { BackgroundTask, BackgroundTaskAttempt, BackgroundTaskStatus } from "./types"

export const BACKGROUND_TASK_METADATA_NAMESPACE = "ohMyOpenAgent"
export const BACKGROUND_TASK_METADATA_KEY = "backgroundTasks"
export const BACKGROUND_TASK_METADATA_VERSION = 1
export const BACKGROUND_TASK_COMPLETED_RETENTION_MS = 5_000
export const BACKGROUND_TASK_PROGRESS_THROTTLE_MS = 1_000

const TERMINAL_STATUSES = new Set<BackgroundTaskStatus>(["completed", "error", "cancelled", "interrupt"])
const ACTIVE_STATUSES = new Set<BackgroundTaskStatus>(["pending", "running"])
const DESCRIPTION_LIMIT = 240
const PROGRESS_MESSAGE_LIMIT = 180
const ERROR_LIMIT = 500

export interface BackgroundTaskModelSnapshot {
  providerID: string
  modelID: string
  variant?: string
}

export interface BackgroundTaskAttemptSnapshot {
  attemptId: string
  attemptNumber: number
  sessionId?: string
  providerID?: string
  modelID?: string
  variant?: string
  status: BackgroundTaskStatus
  error?: string
  startedAt?: string
  completedAt?: string
}

export interface BackgroundTaskSnapshot {
  id: string
  sessionId?: string
  parentSessionId: string
  rootSessionId: string
  parentMessageId: string
  description: string
  agent: string
  category?: string
  status: BackgroundTaskStatus
  model?: BackgroundTaskModelSnapshot
  queuedAt?: string
  startedAt?: string
  completedAt?: string
  elapsedMs: number
  retryCount: number
  progress?: {
    toolCalls: number
    lastTool?: string
    lastMessage?: string
    lastUpdate?: string
  }
  attempts: BackgroundTaskAttemptSnapshot[]
  error?: string
}

export interface BackgroundTasksMetadataV1 {
  version: 1
  rootSessionId: string
  updatedAt: string
  allCompleteAt?: string
  tasks: BackgroundTaskSnapshot[]
}

type SessionMetadataClient = {
  session?: {
    get?: (input: any) => Promise<unknown>
    update?: (input: any) => Promise<unknown>
  }
}

type PublisherLogger = (message: string, metadata?: Record<string, unknown>) => void

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function toIso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined
}

function parseIso(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer !== "object" || timer === null) return
  if (!("unref" in timer) || typeof timer.unref !== "function") return
  timer.unref()
}

function truncateText(value: string | undefined, limit: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`
}

function snapshotModel(model: DelegatedModelConfig | undefined): BackgroundTaskModelSnapshot | undefined {
  if (!model?.providerID || !model.modelID) return undefined
  return {
    providerID: model.providerID,
    modelID: model.modelID,
    ...(model.variant ? { variant: model.variant } : {}),
  }
}

function snapshotAttempt(attempt: BackgroundTaskAttempt): BackgroundTaskAttemptSnapshot {
  return {
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    ...(attempt.sessionId ? { sessionId: attempt.sessionId } : {}),
    ...(attempt.providerId ? { providerID: attempt.providerId } : {}),
    ...(attempt.modelId ? { modelID: attempt.modelId } : {}),
    ...(attempt.variant ? { variant: attempt.variant } : {}),
    status: attempt.status,
    ...(truncateText(attempt.error, ERROR_LIMIT) ? { error: truncateText(attempt.error, ERROR_LIMIT) } : {}),
    ...(toIso(attempt.startedAt) ? { startedAt: toIso(attempt.startedAt) } : {}),
    ...(toIso(attempt.completedAt) ? { completedAt: toIso(attempt.completedAt) } : {}),
  }
}

function elapsedMs(task: BackgroundTask, now: Date): number {
  const start = task.startedAt ?? task.queuedAt
  if (!start) return 0
  const end = task.completedAt ?? now
  return Math.max(0, end.getTime() - start.getTime())
}

function retryCount(task: BackgroundTask): number {
  const fromAttempts = Math.max(0, (task.attempts?.length ?? 0) - 1)
  const fromLegacyCounter = Math.max(0, task.attemptCount ?? 0)
  return Math.max(fromAttempts, fromLegacyCounter)
}

export function rootSessionIdForTask(task: BackgroundTask): string {
  return task.rootSessionId ?? task.parentSessionId
}

export function isTerminalBackgroundTaskStatus(status: BackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function isActiveBackgroundTaskStatus(status: BackgroundTaskStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

export function snapshotBackgroundTask(task: BackgroundTask, now: Date = new Date()): BackgroundTaskSnapshot {
  const progress = task.progress
    ? {
        toolCalls: task.progress.toolCalls,
        ...(task.progress.lastTool ? { lastTool: truncateText(task.progress.lastTool, PROGRESS_MESSAGE_LIMIT) } : {}),
        ...(truncateText(task.progress.lastMessage, PROGRESS_MESSAGE_LIMIT)
          ? { lastMessage: truncateText(task.progress.lastMessage, PROGRESS_MESSAGE_LIMIT) }
          : {}),
        ...(toIso(task.progress.lastUpdate) ? { lastUpdate: toIso(task.progress.lastUpdate) } : {}),
      }
    : undefined

  return {
    id: task.id,
    ...(task.sessionId ? { sessionId: task.sessionId } : {}),
    parentSessionId: task.parentSessionId,
    rootSessionId: rootSessionIdForTask(task),
    parentMessageId: task.parentMessageId,
    description: truncateText(task.description, DESCRIPTION_LIMIT) ?? "",
    agent: task.agent,
    ...(task.category ? { category: task.category } : {}),
    status: task.status,
    ...(snapshotModel(task.model) ? { model: snapshotModel(task.model) } : {}),
    ...(toIso(task.queuedAt) ? { queuedAt: toIso(task.queuedAt) } : {}),
    ...(toIso(task.startedAt) ? { startedAt: toIso(task.startedAt) } : {}),
    ...(toIso(task.completedAt) ? { completedAt: toIso(task.completedAt) } : {}),
    elapsedMs: elapsedMs(task, now),
    retryCount: retryCount(task),
    ...(progress ? { progress } : {}),
    attempts: (task.attempts ?? []).map(snapshotAttempt),
    ...(truncateText(task.error, ERROR_LIMIT) ? { error: truncateText(task.error, ERROR_LIMIT) } : {}),
  }
}

export function selectBackgroundTasksForRoot(
  tasks: Iterable<BackgroundTask>,
  rootSessionId: string,
): BackgroundTask[] {
  return [...tasks]
    .filter((task) => rootSessionIdForTask(task) === rootSessionId)
    .sort((left, right) => {
      const leftTime = left.queuedAt?.getTime() ?? left.startedAt?.getTime() ?? 0
      const rightTime = right.queuedAt?.getTime() ?? right.startedAt?.getTime() ?? 0
      if (leftTime !== rightTime) return leftTime - rightTime
      return left.id.localeCompare(right.id)
    })
}

export function buildBackgroundTasksMetadata(input: {
  rootSessionId: string
  tasks: BackgroundTask[]
  now?: Date
  allCompleteAt?: Date
  completedRetentionMs?: number
}): { metadata: BackgroundTasksMetadataV1; allCompleteAt?: Date; retained: boolean } {
  const now = input.now ?? new Date()
  const active = input.tasks.some((task) => isActiveBackgroundTaskStatus(task.status))
  const completedRetentionMs = input.completedRetentionMs ?? BACKGROUND_TASK_COMPLETED_RETENTION_MS
  let allCompleteAt = active || input.tasks.length === 0 ? undefined : input.allCompleteAt ?? now
  const retained = !allCompleteAt || now.getTime() - allCompleteAt.getTime() < completedRetentionMs
  const tasks = retained ? input.tasks.map((task) => snapshotBackgroundTask(task, now)) : []

  return {
    metadata: {
      version: BACKGROUND_TASK_METADATA_VERSION,
      rootSessionId: input.rootSessionId,
      updatedAt: now.toISOString(),
      ...(allCompleteAt ? { allCompleteAt: allCompleteAt.toISOString() } : {}),
      tasks,
    },
    allCompleteAt,
    retained,
  }
}

export function mergeBackgroundTasksMetadata(
  currentMetadata: unknown,
  snapshot: BackgroundTasksMetadataV1,
): Record<string, unknown> {
  const current = { ...(asRecord(currentMetadata) ?? {}) }
  const namespace = { ...(asRecord(current[BACKGROUND_TASK_METADATA_NAMESPACE]) ?? {}) }
  namespace[BACKGROUND_TASK_METADATA_KEY] = snapshot
  current[BACKGROUND_TASK_METADATA_NAMESPACE] = namespace
  return current
}

function stableMetadataKey(metadata: BackgroundTasksMetadataV1): string {
  return JSON.stringify({
    rootSessionId: metadata.rootSessionId,
    allCompleteAt: metadata.allCompleteAt,
    tasks: metadata.tasks,
  })
}

async function getSessionMetadata(
  client: SessionMetadataClient,
  sessionID: string,
  directory: string,
): Promise<unknown> {
  const get = client.session?.get
  if (typeof get !== "function") return undefined
  const response = await get({
    path: { id: sessionID },
    query: { directory },
  })
  const session = normalizeSDKResponse<{ metadata?: unknown } | undefined>(response, undefined)
  return session?.metadata
}

async function updateSessionMetadata(
  client: SessionMetadataClient,
  sessionID: string,
  directory: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const update = client.session?.update
  if (typeof update !== "function") return

  const response = await update({
    path: { id: sessionID },
    query: { directory },
    body: { metadata },
  })
  if (isRecord(response) && response.error) {
    await update({ sessionID, directory, metadata })
  }
}

export async function publishBackgroundTasksMetadata(input: {
  client: SessionMetadataClient
  directory: string
  rootSessionId: string
  snapshot: BackgroundTasksMetadataV1
}): Promise<void> {
  const current = await getSessionMetadata(input.client, input.rootSessionId, input.directory)
  const merged = mergeBackgroundTasksMetadata(current, input.snapshot)
  await updateSessionMetadata(input.client, input.rootSessionId, input.directory, merged)
}

export class BackgroundTaskMetadataPublisher {
  private readonly client: SessionMetadataClient
  private readonly directory: string
  private readonly getTasks: () => Iterable<BackgroundTask>
  private readonly log: PublisherLogger
  private readonly progressThrottleMs: number
  private readonly completedRetentionMs: number
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly clearTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly allCompleteAt = new Map<string, Date>()
  private readonly lastStableMetadata = new Map<string, string>()

  constructor(input: {
    client: SessionMetadataClient
    directory: string
    getTasks: () => Iterable<BackgroundTask>
    log?: PublisherLogger
    progressThrottleMs?: number
    completedRetentionMs?: number
  }) {
    this.client = input.client
    this.directory = input.directory
    this.getTasks = input.getTasks
    this.log = input.log ?? (() => {})
    this.progressThrottleMs = input.progressThrottleMs ?? BACKGROUND_TASK_PROGRESS_THROTTLE_MS
    this.completedRetentionMs = input.completedRetentionMs ?? BACKGROUND_TASK_COMPLETED_RETENTION_MS
  }

  publishTask(task: BackgroundTask): void {
    this.publishRoot(rootSessionIdForTask(task))
  }

  scheduleProgress(task: BackgroundTask): void {
    this.publishRoot(rootSessionIdForTask(task), this.progressThrottleMs)
  }

  publishRoot(rootSessionId: string, delayMs = 0): void {
    const existing = this.timers.get(rootSessionId)
    if (existing) {
      clearTimeout(existing)
      this.timers.delete(rootSessionId)
    }

    if (delayMs <= 0) {
      void this.enqueuePublish(rootSessionId)
      return
    }

    const timer = setTimeout(() => {
      this.timers.delete(rootSessionId)
      void this.enqueuePublish(rootSessionId)
    }, delayMs)
    unrefTimer(timer)
    this.timers.set(rootSessionId, timer)
  }

  async clearRoots(rootSessionIds: Iterable<string>): Promise<void> {
    const roots = [...new Set(rootSessionIds)].filter(Boolean)
    await Promise.all(roots.map((rootSessionId) => this.enqueuePublish(rootSessionId, true)))
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    for (const timer of this.clearTimers.values()) clearTimeout(timer)
    this.timers.clear()
    this.clearTimers.clear()
  }

  private enqueuePublish(rootSessionId: string, forceClear = false): Promise<void> {
    const previous = this.inFlight.get(rootSessionId) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(() => this.publishSnapshot(rootSessionId, forceClear))
      .finally(() => {
        if (this.inFlight.get(rootSessionId) === current) {
          this.inFlight.delete(rootSessionId)
        }
      })
    this.inFlight.set(rootSessionId, current)
    return current
  }

  private async publishSnapshot(rootSessionId: string, forceClear: boolean): Promise<void> {
    const tasks = forceClear ? [] : selectBackgroundTasksForRoot(this.getTasks(), rootSessionId)
    const now = new Date()
    const hasActive = tasks.some((task) => isActiveBackgroundTaskStatus(task.status))

    if (hasActive || forceClear || tasks.length === 0) {
      this.allCompleteAt.delete(rootSessionId)
      this.clearRootTimer(rootSessionId)
    }

    const { metadata, allCompleteAt, retained } = buildBackgroundTasksMetadata({
      rootSessionId,
      tasks,
      now,
      allCompleteAt: this.allCompleteAt.get(rootSessionId),
      completedRetentionMs: this.completedRetentionMs,
    })

    if (allCompleteAt && retained) {
      this.allCompleteAt.set(rootSessionId, allCompleteAt)
      this.scheduleClearAfterRetention(rootSessionId, allCompleteAt)
    }
    if (!retained) {
      this.allCompleteAt.delete(rootSessionId)
      this.clearRootTimer(rootSessionId)
    }

    const stable = stableMetadataKey(metadata)
    if (this.lastStableMetadata.get(rootSessionId) === stable) return

    try {
      await publishBackgroundTasksMetadata({
        client: this.client,
        directory: this.directory,
        rootSessionId,
        snapshot: metadata,
      })
      this.lastStableMetadata.set(rootSessionId, stable)
    } catch (error) {
      this.log("[background-agent] Failed to publish background task metadata", {
        rootSessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private scheduleClearAfterRetention(rootSessionId: string, allCompleteAt: Date): void {
    const existing = this.clearTimers.get(rootSessionId)
    if (existing) return

    const delay = Math.max(0, this.completedRetentionMs - (Date.now() - allCompleteAt.getTime()))
    const timer = setTimeout(() => {
      this.clearTimers.delete(rootSessionId)
      void this.enqueuePublish(rootSessionId)
    }, delay)
    unrefTimer(timer)
    this.clearTimers.set(rootSessionId, timer)
  }

  private clearRootTimer(rootSessionId: string): void {
    const timer = this.clearTimers.get(rootSessionId)
    if (!timer) return
    clearTimeout(timer)
    this.clearTimers.delete(rootSessionId)
  }
}

export const __test = {
  parseIso,
  stableMetadataKey,
}
