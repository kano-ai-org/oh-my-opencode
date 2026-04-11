import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { createInternalAgentTextPart, normalizeSDKResponse, resolveInheritedPromptTools } from "../../shared"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"
import type { SessionState } from "./types"

const BACKGROUND_CONTINUATION_PROMPT = [
  "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - BACKGROUND CONTINUATION]",
  "Background subagent work is not finished yet.",
  "",
  "- Continue working on the next pending task immediately",
  "- Mark todo items complete as you finish them",
  "- Do not stop just because one background result already exists",
  "- Only stop when all remaining tasks are actually done",
].join("\n")

type Todo = {
  content: string
  status: string
}

export async function injectBackgroundContinuation(input: {
  ctx: PluginInput
  sessionID: string
  agent: string
  backgroundManager?: BackgroundManager
  sessionState: SessionState
}): Promise<void> {
  const hasRunning = input.backgroundManager
    ? input.backgroundManager.getTasksByParentSession(input.sessionID).some((task: { status: string }) => task.status === "running")
    : false

  if (hasRunning) {
    log(`[${HOOK_NAME}] Skipped background continuation: child background tasks running`, { sessionID: input.sessionID })
    return
  }

  const response = await input.ctx.client.session.todo({ path: { id: input.sessionID } })
  const todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
  const pending = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
  if (pending.length === 0) {
    log(`[${HOOK_NAME}] Skipped background continuation: all todos complete`, { sessionID: input.sessionID })
    return
  }

  const todoList = pending.map((todo) => `- [${todo.status}] ${todo.content}`).join("\n")
  const prompt = [
    BACKGROUND_CONTINUATION_PROMPT,
    "",
    `[Status: ${todos.length - pending.length}/${todos.length} completed, ${pending.length} remaining]`,
    "",
    "Remaining tasks:",
    todoList,
  ].join("\n")

  const promptContext = await resolveRecentPromptContextForSession(input.ctx, input.sessionID)
  const tools = resolveInheritedPromptTools(input.sessionID, promptContext.tools)

  await input.ctx.client.session.promptAsync({
    path: { id: input.sessionID },
    body: {
      agent: input.agent,
      ...(promptContext.model ? { model: promptContext.model } : {}),
      ...(tools ? { tools } : {}),
      parts: [createInternalAgentTextPart(prompt)],
    },
    query: { directory: input.ctx.directory },
  })

  input.sessionState.promptFailureCount = 0
  input.sessionState.lastFailureAt = undefined
  log(`[${HOOK_NAME}] Background continuation injected`, { sessionID: input.sessionID, agent: input.agent })
}
