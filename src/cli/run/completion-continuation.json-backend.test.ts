declare const require: (name: string) => any
const { afterAll, afterEach, describe, expect, mock, spyOn, test } = require("bun:test")
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { RunContext } from "./types"

const testDirs: string[] = []
const TEST_STORAGE_ROOT = join(tmpdir(), `omo-run-completion-json-${Date.now()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")
const sessionLastAgentBySessionID = new Map<string, string | null>()

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    return require("node:fs").existsSync(directPath) ? directPath : null
  },
}))

mock.module("../../hooks/atlas/session-last-agent", () => ({
  getLastAgentFromSession: async (sessionID: string) => sessionLastAgentBySessionID.get(sessionID) ?? null,
}))
mock.module("../../hooks/atlas/session-last-agent.ts", () => ({
  getLastAgentFromSession: async (sessionID: string) => sessionLastAgentBySessionID.get(sessionID) ?? null,
}))

afterAll(() => {
  mock.restore()
})

afterEach(() => {
  sessionLastAgentBySessionID.clear()
  while (testDirs.length > 0) {
    const dir = testDirs.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-run-completion-json-backend-"))
  testDirs.push(dir)
  return dir
}

function writeBoulderStateFile(directory: string, planPath: string): void {
  mkdirSync(join(directory, ".sisyphus"), { recursive: true })
  writeFileSync(
    join(directory, ".sisyphus", "boulder.json"),
    JSON.stringify({
      active_plan: planPath,
      started_at: new Date().toISOString(),
      session_ids: ["ses_root_session", "ses_child_session"],
      session_origins: {
        ses_root_session: "direct",
        ses_child_session: "appended",
      },
      plan_name: "json-compaction-plan",
      agent: "atlas",
    }),
    "utf-8",
  )
}

function writeJsonMessage(sessionID: string, fileName: string, agent: string, created: number): void {
  const messageDir = join(TEST_MESSAGE_STORAGE, sessionID)
  mkdirSync(messageDir, { recursive: true })
  writeFileSync(
    join(messageDir, fileName),
    JSON.stringify({
      agent,
      model: { providerID: "openai", modelID: "gpt-5.4" },
      time: { created },
    }),
    "utf-8",
  )
}

function createMockContext(directory: string): RunContext {
  return {
    client: {
      session: {
        todo: mock(() => Promise.resolve({ data: [] })),
        children: mock(() => Promise.resolve({ data: [] })),
        status: mock(() => Promise.resolve({ data: {} })),
        get: mock(async ({ path }: { path: { id: string } }) => ({
          data: {
            id: path.id,
            parentID: path.id === "ses_child_session" ? "ses_root_session" : undefined,
          },
        })),
        messages: mock(async () => ({ data: [] })),
      },
    } as unknown as RunContext["client"],
    sessionID: "ses_child_session",
    directory,
    abortController: new AbortController(),
    verbose: false,
  }
}

describe("checkCompletionConditions JSON backend compaction recovery", () => {
  test("returns false after compaction when descendant session still has active atlas continuation", async () => {
    // given
    spyOn(console, "log").mockImplementation(() => {})
    const directory = createTempDir()
    const plansDir = join(directory, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "json-compaction-plan.md")
    writeFileSync(planPath, "- [ ] unfinished task\n", "utf-8")
    writeBoulderStateFile(directory, planPath)
    writeJsonMessage("ses_child_session", "msg_001.json", "atlas", 100)
    writeJsonMessage("ses_child_session", "msg_002.json", "compaction", 200)
    sessionLastAgentBySessionID.set("ses_child_session", "atlas")
    const ctx = createMockContext(directory)
    const { checkCompletionConditions } = await import("./completion")

    // when
    const result = await checkCompletionConditions(ctx)

    // then
    expect(result).toBe(false)
  })
})
