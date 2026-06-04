import { describe, expect, test } from "bun:test"
import {
  BackgroundTaskMetadataPublisher,
  buildBackgroundTasksMetadata,
  mergeBackgroundTasksMetadata,
  selectBackgroundTasksForRoot,
  snapshotBackgroundTask,
} from "./status-metadata"
import type { BackgroundTask } from "./types"

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_1",
    parentSessionId: "ses_parent",
    rootSessionId: "ses_root",
    parentMessageId: "msg_parent",
    description: "Research the failing build",
    prompt: "SECRET PROMPT",
    result: "SECRET RESULT",
    agent: "oracle",
    status: "running",
    queuedAt: new Date("2026-06-05T00:00:00.000Z"),
    startedAt: new Date("2026-06-05T00:00:10.000Z"),
    model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    attemptCount: 1,
    progress: {
      toolCalls: 2,
      lastTool: "rg",
      lastMessage: "message update",
      lastUpdate: new Date("2026-06-05T00:00:20.000Z"),
    },
    attempts: [
      {
        attemptId: "att_1",
        attemptNumber: 1,
        sessionId: "ses_first",
        providerId: "anthropic",
        modelId: "claude",
        status: "error",
        error: "quota",
        startedAt: new Date("2026-06-05T00:00:10.000Z"),
        completedAt: new Date("2026-06-05T00:00:15.000Z"),
      },
      {
        attemptId: "att_2",
        attemptNumber: 2,
        sessionId: "ses_child",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        status: "running",
        startedAt: new Date("2026-06-05T00:00:16.000Z"),
      },
    ],
    ...overrides,
  }
}

describe("background task status metadata", () => {
  test("serializes safe snapshot fields without prompt or result", () => {
    const snapshot = snapshotBackgroundTask(task(), new Date("2026-06-05T00:00:40.000Z"))
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain("SECRET PROMPT")
    expect(serialized).not.toContain("SECRET RESULT")
    expect(snapshot.model).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" })
    expect(snapshot.elapsedMs).toBe(30_000)
    expect(snapshot.retryCount).toBe(1)
    expect(snapshot.progress).toEqual({
      toolCalls: 2,
      lastTool: "rg",
      lastMessage: "message update",
      lastUpdate: "2026-06-05T00:00:20.000Z",
    })
    expect(snapshot.attempts).toHaveLength(2)
    expect(snapshot.attempts[1]).toMatchObject({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "high",
      status: "running",
    })
  })

  test("aggregates direct and nested tasks under root session id", () => {
    const direct = task({ id: "bg_direct", parentSessionId: "ses_root", rootSessionId: "ses_root" })
    const nested = task({ id: "bg_nested", parentSessionId: "ses_child", rootSessionId: "ses_root" })
    const other = task({ id: "bg_other", parentSessionId: "ses_other", rootSessionId: "ses_other" })

    const selected = selectBackgroundTasksForRoot([other, nested, direct], "ses_root")

    expect(selected.map((item) => item.id)).toEqual(["bg_direct", "bg_nested"])
  })

  test("retains terminal batch briefly, then clears task list", () => {
    const completed = task({
      status: "completed",
      completedAt: new Date("2026-06-05T00:00:45.000Z"),
    })
    const retained = buildBackgroundTasksMetadata({
      rootSessionId: "ses_root",
      tasks: [completed],
      now: new Date("2026-06-05T00:00:46.000Z"),
      allCompleteAt: new Date("2026-06-05T00:00:45.000Z"),
      completedRetentionMs: 5_000,
    })
    const cleared = buildBackgroundTasksMetadata({
      rootSessionId: "ses_root",
      tasks: [completed],
      now: new Date("2026-06-05T00:00:51.000Z"),
      allCompleteAt: new Date("2026-06-05T00:00:45.000Z"),
      completedRetentionMs: 5_000,
    })

    expect(retained.metadata.tasks).toHaveLength(1)
    expect(cleared.metadata.tasks).toHaveLength(0)
  })

  test("metadata merge preserves unrelated session metadata", () => {
    const metadata = buildBackgroundTasksMetadata({
      rootSessionId: "ses_root",
      tasks: [task()],
      now: new Date("2026-06-05T00:00:40.000Z"),
    }).metadata

    expect(mergeBackgroundTasksMetadata({
      titleColor: "blue",
      ohMyOpenAgent: { custom: true },
    }, metadata)).toMatchObject({
      titleColor: "blue",
      ohMyOpenAgent: {
        custom: true,
        backgroundTasks: metadata,
      },
    })
  })

  test("publisher throttles progress updates and skips duplicate terminal snapshots", async () => {
    const updates: unknown[] = []
    let currentMetadata: unknown = { unrelated: true }
    const running = task()
    const client = {
      session: {
        get: async () => ({ data: { metadata: currentMetadata } }),
        update: async (input: { body?: { metadata?: unknown } }) => {
          currentMetadata = input.body?.metadata
          updates.push(input)
          return { data: { metadata: currentMetadata } }
        },
      },
    }

    const publisher = new BackgroundTaskMetadataPublisher({
      client,
      directory: "/tmp/project",
      getTasks: () => [running],
      progressThrottleMs: 10,
      completedRetentionMs: 1_000,
    })

    publisher.scheduleProgress(running)
    publisher.scheduleProgress(running)
    await wait(30)
    expect(updates).toHaveLength(1)

    running.status = "completed"
    running.completedAt = new Date("2026-06-05T00:01:00.000Z")
    publisher.publishTask(running)
    await wait(0)
    publisher.publishTask(running)
    await wait(0)

    expect(updates.length).toBeLessThanOrEqual(2)
    publisher.shutdown()
  })
})
