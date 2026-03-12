import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import {
  _resetForTesting,
  subagentSessions,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { createAtlasHook } from "./index"

const SESSION_ID = "bg-session-123"

function createMockInput(todo: Array<{ id: string; content: string; status: string; priority: string }>) {
  const promptMock = mock(() => Promise.resolve())
  return {
    directory: "/tmp/atlas-background-test",
    client: {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        todo: async () => ({ data: todo }),
        messages: async () => ({ data: [] }),
      },
    },
    _promptMock: promptMock,
  } as any
}

describe("atlas background idle continuation", () => {
  beforeEach(() => {
    _resetForTesting()
    subagentSessions.add(SESSION_ID)
    updateSessionAgent(SESSION_ID, "oracle")
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("continues a background session without boulder state when todos remain", async () => {
    const input = createMockInput([
      { id: "1", content: "Inspect queue flow", status: "in_progress", priority: "high" },
      { id: "2", content: "Ship the fix", status: "pending", priority: "high" },
    ])
    const hook = createAtlasHook(input, { directory: input.directory })

    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: SESSION_ID },
      },
    })

    expect(input._promptMock).toHaveBeenCalledTimes(1)
    const call = input._promptMock.mock.calls[0][0]
    expect(call.path.id).toBe(SESSION_ID)
    expect(call.body.agent).toBe("oracle")
    expect(call.body.parts[0].text).toContain("BACKGROUND CONTINUATION")
    expect(call.body.parts[0].text).toContain("2 remaining")
  })

  test("does not continue a background session when all todos are complete", async () => {
    const input = createMockInput([{ id: "1", content: "Done", status: "completed", priority: "high" }])
    const hook = createAtlasHook(input, { directory: input.directory })

    await hook.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: SESSION_ID },
      },
    })

    expect(input._promptMock).not.toHaveBeenCalled()
  })
})
