import type { PluginInput } from "@opencode-ai/plugin"
import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { getSessionAgent, subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { injectBackgroundContinuation } from "./background-continuation-injector"
import { injectBoulderContinuation } from "./boulder-continuation-injector"
import { HOOK_NAME } from "./hook-name"
import { getLastAgentFromSession } from "./session-last-agent"
import type { AtlasHookOptions, SessionState } from "./types"

const CONTINUATION_COOLDOWN_MS = 5000
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = CONTINUATION_COOLDOWN_MS + 1000

function hasRunningTasks(sessionID: string, options?: AtlasHookOptions) {
  return options?.backgroundManager
    ? options.backgroundManager.getTasksByParentSession(sessionID).some((task: { status: string }) => task.status === "running")
    : false
}

function isCooling(state: SessionState, now: number) {
  return !!state.lastContinuationInjectedAt && now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS
}

function scheduleRetry(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessionID: string
  state: SessionState
}) {
  if (input.state.pendingRetryTimer) return
  input.state.pendingRetryTimer = setTimeout(async () => {
    input.state.pendingRetryTimer = undefined
    if (input.state.promptFailureCount >= 2) return
    const boulder = readBoulderState(input.ctx.directory)
    if (!boulder?.session_ids?.includes(input.sessionID)) return
    if (input.options?.isContinuationStopped?.(input.sessionID)) return
    if (hasRunningTasks(input.sessionID, input.options)) return
    const progress = getPlanProgress(boulder.active_plan)
    if (progress.isComplete) return
    input.state.lastContinuationInjectedAt = Date.now()
    const remaining = progress.total - progress.completed
    await injectBoulderContinuation({
      ctx: input.ctx,
      sessionID: input.sessionID,
      planName: boulder.plan_name,
      remaining,
      total: progress.total,
      agent: boulder.agent,
      worktreePath: boulder.worktree_path,
      backgroundManager: input.options?.backgroundManager,
      sessionState: input.state,
    }).catch((err) => {
      log(`[${HOOK_NAME}] Delayed retry failed`, { sessionID: input.sessionID, error: err })
      input.state.promptFailureCount += 1
      input.state.lastFailureAt = Date.now()
    })
  }, RETRY_DELAY_MS)
}

export async function handleAtlasIdleEvent(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessionID: string
  state: SessionState
}): Promise<void> {
  const boulder = readBoulderState(input.ctx.directory)
  const background = subagentSessions.has(input.sessionID)
  const inBoulder = boulder?.session_ids?.includes(input.sessionID) ?? false
  if (!background && !inBoulder) {
    log(`[${HOOK_NAME}] Skipped: not boulder or background task session`, { sessionID: input.sessionID })
    return
  }

  const now = Date.now()
  if (input.state.lastEventWasAbortError) {
    input.state.lastEventWasAbortError = false
    log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID: input.sessionID })
    return
  }

  if (input.state.promptFailureCount >= 2) {
    const elapsed = input.state.lastFailureAt !== undefined ? now - input.state.lastFailureAt : Number.POSITIVE_INFINITY
    if (elapsed < FAILURE_BACKOFF_MS) {
      log(`[${HOOK_NAME}] Skipped: continuation in backoff after repeated failures`, {
        sessionID: input.sessionID,
        promptFailureCount: input.state.promptFailureCount,
        backoffRemaining: FAILURE_BACKOFF_MS - elapsed,
      })
      return
    }
    input.state.promptFailureCount = 0
    input.state.lastFailureAt = undefined
  }

  if (hasRunningTasks(input.sessionID, input.options)) {
    log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID: input.sessionID })
    return
  }

  if (input.options?.isContinuationStopped?.(input.sessionID)) {
    log(`[${HOOK_NAME}] Skipped: continuation stopped for session`, { sessionID: input.sessionID })
    return
  }

  const sessionAgent = getSessionAgent(input.sessionID)
  const lastAgent = await getLastAgentFromSession(input.sessionID, input.ctx.client)
  const agent = sessionAgent ?? lastAgent

  if (background && !inBoulder) {
    if (!agent) {
      log(`[${HOOK_NAME}] Skipped: no agent resolved for background session`, { sessionID: input.sessionID })
      return
    }
    if (isCooling(input.state, now)) {
      log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, {
        sessionID: input.sessionID,
        cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - input.state.lastContinuationInjectedAt!),
      })
      return
    }
    input.state.lastContinuationInjectedAt = now
    await injectBackgroundContinuation({
      ctx: input.ctx,
      sessionID: input.sessionID,
      agent,
      backgroundManager: input.options?.backgroundManager,
      sessionState: input.state,
    }).catch((err) => {
      log(`[${HOOK_NAME}] Failed to inject background continuation`, { sessionID: input.sessionID, error: err })
      input.state.promptFailureCount += 1
      input.state.lastFailureAt = Date.now()
    })
    return
  }

  if (!boulder) {
    log(`[${HOOK_NAME}] No active boulder`, { sessionID: input.sessionID })
    return
  }

  const lastAgentKey = getAgentConfigKey(agent ?? "")
  const requiredAgent = getAgentConfigKey(boulder.agent ?? "atlas")
  const agentMatches = lastAgentKey === requiredAgent || (requiredAgent === "atlas" && lastAgentKey === "sisyphus")
  if (!agentMatches) {
    log(`[${HOOK_NAME}] Skipped: last agent does not match boulder agent`, {
      sessionID: input.sessionID,
      lastAgent: agent ?? "unknown",
      requiredAgent,
    })
    return
  }

  const progress = getPlanProgress(boulder.active_plan)
  if (progress.isComplete) {
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID: input.sessionID, plan: boulder.plan_name })
    return
  }

  if (isCooling(input.state, now)) {
    scheduleRetry(input)
    log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, {
      sessionID: input.sessionID,
      cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - input.state.lastContinuationInjectedAt!),
      pendingRetry: !!input.state.pendingRetryTimer,
    })
    return
  }

  input.state.lastContinuationInjectedAt = now
  const remaining = progress.total - progress.completed
  await injectBoulderContinuation({
    ctx: input.ctx,
    sessionID: input.sessionID,
    planName: boulder.plan_name,
    remaining,
    total: progress.total,
    agent: boulder.agent,
    worktreePath: boulder.worktree_path,
    backgroundManager: input.options?.backgroundManager,
    sessionState: input.state,
  }).catch((err) => {
    log(`[${HOOK_NAME}] Failed to inject boulder continuation`, { sessionID: input.sessionID, error: err })
    input.state.promptFailureCount += 1
    input.state.lastFailureAt = Date.now()
  })
}
