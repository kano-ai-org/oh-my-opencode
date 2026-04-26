import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { Database } from "bun:sqlite"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const TEST_DIR = join(tmpdir(), `omo-test-session-manager-fallback-${randomUUID()}`)
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_SESSION_STORAGE = join(TEST_DIR, "session")
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const TEST_TRANSCRIPT_DIR = join(TEST_DIR, "transcripts")

let sqliteBackend = false

mock.module("./constants", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  SESSION_STORAGE: TEST_SESSION_STORAGE,
  TODO_DIR: TEST_TODO_DIR,
  TRANSCRIPT_DIR: TEST_TRANSCRIPT_DIR,
  SESSION_LIST_DESCRIPTION: "test",
  SESSION_READ_DESCRIPTION: "test",
  SESSION_SEARCH_DESCRIPTION: "test",
  SESSION_INFO_DESCRIPTION: "test",
  SESSION_DELETE_DESCRIPTION: "test",
  TOOL_NAME_PREFIX: "session_",
}))

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => sqliteBackend,
  resetSqliteBackendCache: () => {},
}))

mock.module("../../shared/data-path", () => ({
  getDataDir: () => TEST_DIR,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    if (!sessionID.startsWith("ses_")) return null
    if (/[/\\]|\.\./.test(sessionID)) return null
    if (!existsSync(TEST_MESSAGE_STORAGE)) return null

    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    if (existsSync(directPath)) return directPath

    for (const dir of readdirSync(TEST_MESSAGE_STORAGE)) {
      const nestedPath = join(TEST_MESSAGE_STORAGE, dir, sessionID)
      if (existsSync(nestedPath)) return nestedPath
    }

    return null
  },
}))

afterAll(() => {
  mock.restore()
})

const storage = await import("./storage")

function createSdkUnavailableError(message: string): Error {
  return new Error(message)
}

function createSessionMetadata(projectID: string, sessionID: string, directory: string, updated: number): void {
  const projectDir = join(TEST_SESSION_STORAGE, projectID)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(
    join(projectDir, `${sessionID}.json`),
    JSON.stringify({
      id: sessionID,
      projectID,
      directory,
      time: { created: updated - 1_000, updated },
    }),
  )
}

function createSessionMessage(sessionID: string, messageID: string, created: number, role = "user"): void {
  const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
  mkdirSync(sessionPath, { recursive: true })
  writeFileSync(
    join(sessionPath, `${messageID}.json`),
    JSON.stringify({ id: messageID, role, time: { created } }),
  )
}

function createSessionTodo(sessionID: string, items: Array<Record<string, unknown>>): void {
  mkdirSync(TEST_TODO_DIR, { recursive: true })
  writeFileSync(join(TEST_TODO_DIR, `${sessionID}.json`), JSON.stringify(items))
}

function createSqliteDb(): Database {
  const dir = join(TEST_DIR, "opencode")
  mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, "opencode.db"))
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workspace_id TEXT,
      parent_id TEXT,
      slug TEXT,
      directory TEXT NOT NULL,
      title TEXT,
      version TEXT,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_compacting INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER,
      time_updated INTEGER,
      data TEXT NOT NULL
    );
  `)
  return db
}

describe("session-manager storage fallback", () => {
  const mockClient = {
    session: {
      list: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      messages: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
      todo: mock((): Promise<unknown> => Promise.resolve({ data: [] })),
    },
  }

  beforeEach(() => {
    sqliteBackend = true
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_SESSION_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
    mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true })
    mockClient.session.list.mockReset()
    mockClient.session.messages.mockReset()
    mockClient.session.todo.mockReset()
    storage.setStorageClient(mockClient as never)
  })

  afterEach(() => {
    storage.resetStorageClient()
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  test("#given unreachable SDK list response #when getMainSessions runs #then falls back to file sessions", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ error: createSdkUnavailableError("fetch failed ECONNREFUSED") }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("ses_file")
  })

  test("#given empty SDK list response #when getMainSessions runs #then returns file-backed pre-migration sessions", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe("ses_file")
  })

  test("#given file-backed windows path variant #when getMainSessions runs #then normalizes directory separators and case", async () => {
    createSessionMetadata("proj_test", "ses_file", "D:/Workspace/Project", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessions = await storage.getMainSessions({ directory: "d:\\workspace\\project\\" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe("ses_file")
  })

  test("#given SDK and file sessions overlap #when getMainSessions runs #then dedupes by id and keeps SDK metadata", async () => {
    createSessionMetadata("proj_test", "ses_file", "/workspace/project", 2_000)
    createSessionMetadata("proj_test", "ses_sdk", "/workspace/project", 1_500)
    mockClient.session.list.mockImplementation(() => Promise.resolve({
      data: [
        {
          id: "ses_sdk",
          projectID: "sdk_project",
          directory: "/workspace/project",
          time: { created: 3_000, updated: 4_000 },
        },
      ],
    }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.id)).toEqual(["ses_sdk", "ses_file"])
    expect(sessions[0].projectID).toBe("sdk_project")
  })

  test("#given empty SDK session list #when getAllSessions runs #then returns file-backed session ids", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessionIds = await storage.getAllSessions()

    expect(sessionIds).toEqual(["ses_file"])
  })

  test("#given SDK and file session ids overlap #when getAllSessions runs #then returns deduped union", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    createSessionMessage("ses_sdk", "msg_002", 2_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({
      data: [
        { id: "ses_sdk" },
      ],
    }))

    const sessionIds = await storage.getAllSessions()

    expect(sessionIds).toEqual(["ses_sdk", "ses_file"])
  })

  test("#given unreachable SDK messages error #when readSessionMessages runs #then falls back to file messages", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() => Promise.reject(createSdkUnavailableError("Unable to connect to http://localhost:4096")))

    const messages = await storage.readSessionMessages("ses_file")

    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_001")
  })

  test("#given empty SDK messages response #when readSessionMessages runs #then falls back to file messages", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))

    const messages = await storage.readSessionMessages("ses_file")

    expect(messages).toHaveLength(1)
    expect(messages[0].id).toBe("msg_001")
  })

  test("#given unreachable SDK todo response #when readSessionTodos runs #then falls back to file todos", async () => {
    createSessionTodo("ses_file", [{ id: "todo_1", content: "Fallback todo", status: "pending" }])
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ error: createSdkUnavailableError("network error: server unreachable") }))

    const todos = await storage.readSessionTodos("ses_file")

    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe("Fallback todo")
  })

  test("#given empty SDK todo response #when readSessionTodos runs #then falls back to file todos", async () => {
    createSessionTodo("ses_file", [{ id: "todo_1", content: "Fallback todo", status: "pending" }])
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ data: [] }))

    const todos = await storage.readSessionTodos("ses_file")

    expect(todos).toHaveLength(1)
    expect(todos[0].content).toBe("Fallback todo")
  })

  test("#given unreachable SDK list error #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.reject(createSdkUnavailableError("ETIMEDOUT while connecting")))

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given empty SDK session list #when sessionExists runs #then falls back to file existence", async () => {
    createSessionMessage("ses_file", "msg_001", 1_000)
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const exists = await storage.sessionExists("ses_file")

    expect(exists).toBe(true)
  })

  test("#given empty SDK session list and sqlite session #when sessionExists runs #then falls back to sqlite existence", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.close()
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const exists = await storage.sessionExists("ses_sqlite")

    expect(exists).toBe(true)
  })

  test("#given empty SDK list and sqlite session #when getMainSessions runs #then returns sqlite sessions", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.close()
    mockClient.session.list.mockImplementation(() => Promise.resolve({ data: [] }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id).toBe("ses_sqlite")
  })

  test("#given sdk and sqlite sessions #when getMainSessions runs #then returns merged sessions", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.close()
    mockClient.session.list.mockImplementation(() => Promise.resolve({
      data: [
        {
          id: "ses_sdk",
          projectID: "proj_sdk",
          directory: "/workspace/project",
          time: { created: 3000, updated: 4000 },
        },
      ],
    }))

    const sessions = await storage.getMainSessions({ directory: "/workspace/project" })

    expect(sessions).toHaveLength(2)
    expect(sessions.map((session) => session.id)).toEqual(["ses_sdk", "ses_sqlite"])
  })

  test("#given empty SDK messages and sqlite rows #when readSessionMessages runs #then returns sqlite messages", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run("msg_sqlite", "ses_sqlite", 3000, 3000, JSON.stringify({ role: "user", agent: "build" }))
    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`).run("prt_sqlite", "msg_sqlite", "ses_sqlite", 3001, 3001, JSON.stringify({ type: "text", text: "hello sqlite" }))
    db.close()
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))

    const messages = await storage.readSessionMessages("ses_sqlite")

    expect(messages).toHaveLength(1)
    expect(messages[0]?.parts[0]?.text).toBe("hello sqlite")
  })

  test("#given malformed sqlite rows alongside valid rows #when readSessionMessages runs #then skips malformed rows", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run("msg_bad", "ses_sqlite", 2000, 2000, "not-json")
    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run("msg_good", "ses_sqlite", 3000, 3000, JSON.stringify({ role: "assistant", agent: "build" }))
    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`).run("prt_bad", "msg_good", "ses_sqlite", 3001, 3001, "not-json")
    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`).run("prt_good", "msg_good", "ses_sqlite", 3002, 3002, JSON.stringify({ type: "text", text: "survives" }))
    db.close()
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))

    const messages = await storage.readSessionMessages("ses_sqlite")

    expect(messages).toHaveLength(1)
    expect(messages[0]?.id).toBe("msg_good")
    expect(messages[0]?.parts[0]?.text).toBe("survives")
  })

  test("#given sqlite session info and file todos #when getSessionInfo runs #then returns merged metadata", async () => {
    const db = createSqliteDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_sqlite", "proj_sqlite", "/workspace/project", "SQLite", 1000, 2000)
    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run("msg_sqlite", "ses_sqlite", 3000, 3000, JSON.stringify({ role: "user", agent: "build" }))
    db.close()
    createSessionTodo("ses_sqlite", [{ id: "todo_1", content: "carry me", status: "pending" }])
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ data: [] }))
    mockClient.session.todo.mockImplementation(() => Promise.resolve({ data: [] }))

    const info = await storage.getSessionInfo("ses_sqlite")

    expect(info?.id).toBe("ses_sqlite")
    expect(info?.has_todos).toBe(true)
    expect(info?.todos?.[0]?.content).toBe("carry me")
  })

  test("#given semantic SDK error #when readSessionMessages runs #then rethrows instead of hiding bug", async () => {
    mockClient.session.messages.mockImplementation(() => Promise.resolve({ error: new Error("session not found") }))

    await expect(storage.readSessionMessages("ses_missing")).rejects.toThrow("session not found")
  })
})
