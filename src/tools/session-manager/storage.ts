import type { PluginInput } from "@opencode-ai/plugin"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { log } from "../../shared"
import { getFileAllSessions, getFileMainSessions, fileSessionExists, getFileSessionInfo, getFileSessionMessages, getFileSessionTodos, getFileSessionTranscript } from "./file-storage"
import { getSqliteAllSessions, getSqliteMainSessions, getSqliteSessionInfo, getSqliteSessionMessages, sqliteSessionExists } from "./sqlite-storage"
import { getSdkAllSessions, getSdkMainSessions, getSdkSessionMessages, getSdkSessionTodos, sdkSessionExists, shouldFallbackFromSdkError } from "./sdk-storage"
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"

export interface GetMainSessionsOptions {
  directory?: string
}

function mergeSessionMetadataLists(
  sdkSessions: SessionMetadata[],
  fileSessions: SessionMetadata[],
): SessionMetadata[] {
  const merged = new Map<string, SessionMetadata>()

  for (const session of fileSessions) {
    merged.set(session.id, session)
  }

  for (const session of sdkSessions) {
    merged.set(session.id, session)
  }

  return [...merged.values()].sort((a, b) => b.time.updated - a.time.updated)
}

function mergeSessionIds(sdkSessionIds: string[], fileSessionIds: string[]): string[] {
  return [...new Set([...sdkSessionIds, ...fileSessionIds])]
}

function mergeSessionInfo(
  info: SessionInfo,
  todos: TodoItem[],
  transcriptEntries: number,
): SessionInfo {
  return {
    ...info,
    has_todos: todos.length > 0,
    has_transcript: transcriptEntries > 0,
    todos,
    transcript_entries: transcriptEntries,
  }
}

// SDK client reference for beta mode
let sdkClient: PluginInput["client"] | null = null

export function setStorageClient(client: PluginInput["client"]): void {
  sdkClient = client
}

export function resetStorageClient(): void {
  sdkClient = null
}

export async function getMainSessions(options: GetMainSessionsOptions): Promise<SessionMetadata[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessions = await getSdkMainSessions(sdkClient, options.directory)
      const fileSessions = await getFileMainSessions(options.directory)
      const sqliteSessions = await getSqliteMainSessions(options.directory)
      return mergeSessionMetadataLists(sdkSessions, mergeSessionMetadataLists(sqliteSessions, fileSessions))
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session list after SDK unavailable error", { error: String(error) })
    }
  }

  if (isSqliteBackend()) {
    const sqliteSessions = await getSqliteMainSessions(options.directory)
    const fileSessions = await getFileMainSessions(options.directory)
    const sessions = mergeSessionMetadataLists(sqliteSessions, fileSessions)
    if (sessions.length > 0) return sessions
  }

  return getFileMainSessions(options.directory)
}

export async function getAllSessions(): Promise<string[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessionIds = await getSdkAllSessions(sdkClient)
      const fileSessionIds = await getFileAllSessions()
      const sqliteSessionIds = await getSqliteAllSessions()
      return mergeSessionIds(sdkSessionIds, mergeSessionIds(sqliteSessionIds, fileSessionIds))
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session ids after SDK unavailable error", { error: String(error) })
    }
  }

  if (isSqliteBackend()) {
    const rows = mergeSessionIds(await getSqliteAllSessions(), await getFileAllSessions())
    if (rows.length > 0) return rows
  }

  return getFileAllSessions()
}

export { getMessageDir } from "../../shared/opencode-message-dir"

export async function sessionExists(sessionID: string): Promise<boolean> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const existsInSdk = await sdkSessionExists(sdkClient, sessionID)
      if (existsInSdk) return true
      const existsInSqlite = await sqliteSessionExists(sessionID)
      if (existsInSqlite) return true
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file sessionExists after SDK unavailable error", { error: String(error), sessionID })
    }
  }
  if (isSqliteBackend()) {
    const exists = await sqliteSessionExists(sessionID)
    if (exists) return true
  }
  return fileSessionExists(sessionID)
}

export async function readSessionMessages(sessionID: string): Promise<SessionMessage[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = await getSdkSessionMessages(sdkClient, sessionID)
      if (sdkMessages.length > 0) return sdkMessages
      const sqliteMessages = await getSqliteSessionMessages(sessionID)
      if (sqliteMessages.length > 0) return sqliteMessages
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session messages after SDK unavailable error", { error: String(error), sessionID })
    }
  }

  if (isSqliteBackend()) {
    const rows = await getSqliteSessionMessages(sessionID)
    if (rows.length > 0) return rows
  }

  return getFileSessionMessages(sessionID)
}

export async function readSessionTodos(sessionID: string): Promise<TodoItem[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkTodos = await getSdkSessionTodos(sdkClient, sessionID)
      if (sdkTodos.length > 0) return sdkTodos
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session todos after SDK unavailable error", { error: String(error), sessionID })
    }
  }

  return getFileSessionTodos(sessionID)
}

export async function readSessionTranscript(sessionID: string): Promise<number> {
  return getFileSessionTranscript(sessionID)
}

export async function getSessionInfo(sessionID: string): Promise<SessionInfo | null> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = await getSdkSessionMessages(sdkClient, sessionID)
      if (sdkMessages.length > 0) {
        const agentsUsed = new Set<string>()
        let firstMessage: Date | undefined
        let lastMessage: Date | undefined

        for (const msg of sdkMessages) {
          if (msg.agent) agentsUsed.add(msg.agent)
          if (msg.time?.created) {
            const date = new Date(msg.time.created)
            if (!firstMessage || date < firstMessage) firstMessage = date
            if (!lastMessage || date > lastMessage) lastMessage = date
          }
        }

        const todos = await readSessionTodos(sessionID)
        const transcriptEntries = await readSessionTranscript(sessionID)

        return {
          id: sessionID,
          message_count: sdkMessages.length,
          first_message: firstMessage,
          last_message: lastMessage,
          agents_used: Array.from(agentsUsed),
          has_todos: todos.length > 0,
          has_transcript: transcriptEntries > 0,
          todos,
          transcript_entries: transcriptEntries,
        }
      }
      const sqliteInfo = await getSqliteSessionInfo(sessionID)
      if (sqliteInfo) {
        return mergeSessionInfo(
          sqliteInfo,
          await readSessionTodos(sessionID),
          await readSessionTranscript(sessionID),
        )
      }
    } catch (error) {
      if (!shouldFallbackFromSdkError(error)) throw error
      log("[session-manager] falling back to file session info after SDK unavailable error", { error: String(error), sessionID })
    }
  }

  if (isSqliteBackend()) {
    const info = await getSqliteSessionInfo(sessionID)
    if (info) {
      return mergeSessionInfo(
        info,
        await readSessionTodos(sessionID),
        await readSessionTranscript(sessionID),
      )
    }
  }

  return getFileSessionInfo(sessionID)
}
