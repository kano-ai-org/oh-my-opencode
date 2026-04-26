import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createSessionManagerTools } from "./tools"
import type { SearchResult, SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"

const projectDir = "/Users/yeongyu/local-workspaces/oh-my-opencode"
const locator = "RDpcX3dvcmtcX0hvcml6b25cSG9yaXpvblVJUGx1Z2luRGVtbw/session/ses_test123"

const mockCtx = { directory: projectDir } as PluginInput

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTestTools() {
  return createSessionManagerTools(mockCtx, {
    setStorageClient: () => {},
    getMainSessions: async (): Promise<SessionMetadata[]> => [],
    filterSessionsByDate: async (ids) => ids,
    formatSessionList: async () => "sessions:0",
    sessionExists: async (id) => id === "ses_test123",
    readSessionMessages: async (id): Promise<SessionMessage[]> =>
      id === "ses_test123"
        ? [{ id: "msg_1", role: "user", time: { created: Date.now() }, parts: [{ id: "prt_1", type: "text", text: "hello" }] }]
        : [],
    readSessionTodos: async (): Promise<TodoItem[]> => [],
    formatSessionMessages: (messages) => `messages:${messages.length}`,
    getAllSessions: async () => ["ses_test123"],
    searchInSession: async (id): Promise<SearchResult[]> => [
      {
        session_id: id,
        message_id: `${id}-msg`,
        excerpt: "test snippet",
        role: "user",
        match_count: 1,
      },
    ],
    formatSearchResults: (results) => `results:${results.length}`,
    getSessionInfo: async (id): Promise<SessionInfo | null> =>
      id === "ses_test123"
        ? {
            id,
            message_count: 1,
            first_message: new Date(),
            last_message: new Date(),
            agents_used: ["test-agent"],
            has_todos: false,
            has_transcript: false,
            todos: [],
            transcript_entries: 0,
          }
        : null,
    formatSessionInfo: (info) => `info:${info.id}`,
  })
}

describe("session-manager locator inputs", () => {
  test("session_read normalizes locator-style session ids", async () => {
    const { session_read } = createTestTools()
    const result = await session_read.execute({ session_id: locator }, mockContext)

    expect(result).toBe("messages:1")
  })

  test("session_search normalizes locator-style session ids", async () => {
    const { session_search } = createTestTools()
    const result = await session_search.execute({ query: "test", session_id: locator }, mockContext)

    expect(result).toBe("results:1")
  })

  test("session_info normalizes locator-style session ids", async () => {
    const { session_info } = createTestTools()
    const result = await session_info.execute({ session_id: locator }, mockContext)

    expect(result).toBe("info:ses_test123")
  })
})
