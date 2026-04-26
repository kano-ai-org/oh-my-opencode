import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { getDataDir } from "../../shared/data-path"
import type { SessionInfo, SessionMessage, SessionMetadata } from "./types"

type SessionRow = {
  id: string
  project_id: string
  directory: string
  title: string | null
  parent_id: string | null
  time_created: number
  time_updated: number
  time_archived: number | null
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: number | null
}

type MessageRow = {
  id: string
  time_created: number
  data: string
}

type PartRow = {
  id: string
  message_id: string
  data: string
}

function getDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

function normalize(dir: string): string {
  const next = dir.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!/^[A-Za-z]:\//.test(next)) return next
  return `${next.slice(0, 1).toUpperCase()}${next.slice(1).toLowerCase()}`
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function withDb<T>(fn: (db: Database) => T): T | null {
  const file = getDbPath()
  if (!existsSync(file)) return null
  const db = new Database(file, { readonly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export async function getSqliteMainSessions(directory?: string): Promise<SessionMetadata[]> {
  const rows = withDb((db) => {
    const stmt = directory
      ? db.query(
          `SELECT id, project_id, directory, title, parent_id, time_created, time_updated, time_archived, summary_additions, summary_deletions, summary_files
           FROM session
           WHERE parent_id IS NULL
             AND time_archived IS NULL
             AND lower(replace(directory, '\\', '/')) = lower(?)
           ORDER BY time_updated DESC, id DESC`,
        )
      : db.query(
          `SELECT id, project_id, directory, title, parent_id, time_created, time_updated, time_archived, summary_additions, summary_deletions, summary_files
           FROM session
           WHERE parent_id IS NULL
             AND time_archived IS NULL
           ORDER BY time_updated DESC, id DESC`,
        )
    return directory
      ? stmt.all(normalize(directory)) as SessionRow[]
      : stmt.all() as SessionRow[]
  })
  if (!rows) return []
  return rows.map((row) => ({
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    ...(row.title ? { title: row.title } : {}),
    ...(row.parent_id ? { parentID: row.parent_id } : {}),
    time: { created: row.time_created, updated: row.time_updated },
    ...(row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null
      ? {
          summary: {
            additions: row.summary_additions ?? 0,
            deletions: row.summary_deletions ?? 0,
            files: row.summary_files ?? 0,
          },
        }
      : {}),
  }))
}

export async function getSqliteAllSessions(): Promise<string[]> {
  const rows = withDb((db) =>
    db.query(`SELECT id FROM session ORDER BY time_updated DESC, id DESC`).all() as Array<{ id: string }>,
  )
  return rows?.map((row) => row.id) ?? []
}

export async function sqliteSessionExists(sessionID: string): Promise<boolean> {
  const row = withDb((db) =>
    db.query(`SELECT id FROM session WHERE id = ? LIMIT 1`).get(sessionID) as { id: string } | null,
  )
  return !!row
}

export async function getSqliteSessionMessages(sessionID: string): Promise<SessionMessage[]> {
  const rows = withDb((db) => {
    const msgs = db.query(`SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC`).all(sessionID) as MessageRow[]
    const parts = db.query(`SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY time_created ASC, id ASC`).all(sessionID) as PartRow[]
    return { msgs, parts }
  })
  if (!rows) return []
  const grouped = new Map<string, SessionMessage["parts"]>()
  for (const row of rows.parts) {
    const data = tryParseJson(row.data)
    if (!data) continue
    const list = grouped.get(row.message_id) ?? []
    list.push({
      id: row.id,
      type: typeof data.type === "string" ? data.type : "text",
      ...(typeof data.text === "string" ? { text: data.text } : {}),
      ...(typeof data.thinking === "string" ? { thinking: data.thinking } : {}),
      ...(typeof data.tool === "string" ? { tool: data.tool } : {}),
      ...(typeof data.callID === "string" ? { callID: data.callID } : {}),
      ...(data.input && typeof data.input === "object" ? { input: data.input as Record<string, unknown> } : {}),
      ...(typeof data.output === "string" ? { output: data.output } : {}),
      ...(typeof data.error === "string" ? { error: data.error } : {}),
    })
    grouped.set(row.message_id, list)
  }
  const messages: SessionMessage[] = []
  for (const row of rows.msgs) {
    const data = tryParseJson(row.data)
    if (!data) continue
    const time = typeof row.time_created === "number" ? { created: row.time_created } : undefined
    messages.push({
      id: row.id,
      role: data.role === "assistant" ? "assistant" : "user",
      ...(typeof data.agent === "string" ? { agent: data.agent } : {}),
      ...(time ? { time } : {}),
      parts: grouped.get(row.id) ?? [],
    } satisfies SessionMessage)
  }
  return messages
}

export async function getSqliteSessionInfo(sessionID: string): Promise<SessionInfo | null> {
  const messages = await getSqliteSessionMessages(sessionID)
  if (messages.length === 0) return null
  const agents = new Set<string>()
  let first: Date | undefined
  let last: Date | undefined
  for (const msg of messages) {
    if (msg.agent) agents.add(msg.agent)
    if (!msg.time?.created) continue
    const date = new Date(msg.time.created)
    if (!first || date < first) first = date
    if (!last || date > last) last = date
  }
  return {
    id: sessionID,
    message_count: messages.length,
    first_message: first,
    last_message: last,
    agents_used: [...agents],
    has_todos: false,
    has_transcript: false,
    transcript_entries: 0,
  }
}
