import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

const ROOT = join(tmpdir(), `omo-test-session-manager-sqlite-${randomUUID()}`)
const DATA = join(ROOT, "data")
const DB_DIR = join(DATA, "opencode")
const DB_PATH = join(DB_DIR, "opencode.db")

mock.module("../../shared/data-path", () => ({
  getDataDir: () => DATA,
}))

const storage = await import("./sqlite-storage")

function setupDb() {
  mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
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

describe("session-manager sqlite storage", () => {
  beforeEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
    mkdirSync(ROOT, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(ROOT)) rmSync(ROOT, { recursive: true, force: true })
  })

  test("reads main sessions directly from sqlite", async () => {
    const db = setupDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_main", "proj_1", "D:/work/repo", "Main", 100, 200)
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`).run("ses_child", "proj_1", "ses_main", "D:/work/repo", "Child", 101, 201)
    db.close()

    const rows = await storage.getSqliteMainSessions("d:\\work\\repo")

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe("ses_main")
  })

  test("detects sqlite session existence and reads messages", async () => {
    const db = setupDb()
    db.query(`INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL)`).run("ses_live", "proj_1", "/repo", "Live", 100, 200)
    db.query(`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)`).run(
      "msg_1",
      "ses_live",
      300,
      300,
      JSON.stringify({ role: "user", agent: "build" }),
    )
    db.query(`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)`).run(
      "prt_1",
      "msg_1",
      "ses_live",
      301,
      301,
      JSON.stringify({ type: "text", text: "hello" }),
    )
    db.close()

    expect(await storage.sqliteSessionExists("ses_live")).toBe(true)
    const messages = await storage.getSqliteSessionMessages("ses_live")
    expect(messages).toHaveLength(1)
    expect(messages[0]?.parts[0]?.text).toBe("hello")
  })
})
