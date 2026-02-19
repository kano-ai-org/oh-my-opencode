import type { PluginInput } from "@opencode-ai/plugin"
import {
  appendSessionId,
  clearBoulderState,
  createBoulderState,
  getPlanProgress,
  readBoulderState,
  writeBoulderState,
} from "../../features/boulder-state"
import type { SisyphusConfig } from "../../config"
import {
  getAgentConfigKey,
  getAgentDisplayName,
  getAgentListDisplayName,
} from "../../shared/agent-display-names"
import {
  getSessionAgent,
  isAgentRegistered,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { parseUserRequest } from "./parse-user-request"
import {
  buildAutoSelectedPlanMessage,
  buildPlanAlreadyCompleteMessage,
  buildPlanNotFoundMessage,
  buildResumeMessage,
} from "./start-work-context-messages"
import { findPlansForStartWork } from "./start-work-plan-provider"
import { buildDiscoveryContextInfo, findPlanByName, getStartWorkConfig } from "./start-work-resolver"
import { createWorktreeActiveBlock } from "./worktree-block"
import { detectWorktreePath } from "./worktree-detector"

export const HOOK_NAME = "start-work" as const
const START_WORK_TEMPLATE_MARKER = "You are starting a Sisyphus work session."

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkCommandExecuteBeforeInput {
  sessionID: string
  command: string
  arguments: string
}

interface StartWorkHookOutput {
  message?: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

const MODEL_DECIDES_WORKTREE_BLOCK = `
## Worktree Setup Required

No worktree specified. Before starting work, you MUST choose or create one:

1. \`git worktree list --porcelain\` — list existing worktrees
2. Create if needed: \`git worktree add <absolute-path> <branch-or-HEAD>\`
3. Update \`.sisyphus/boulder.json\` — add \`"worktree_path": "<absolute-path>"\`
4. Work exclusively inside that worktree directory`

function resolveWorktreeContext(
  explicitWorktreePath: string | null,
): { worktreePath: string | undefined; block: string } {
  if (explicitWorktreePath === null) {
    return { worktreePath: undefined, block: MODEL_DECIDES_WORKTREE_BLOCK }
  }

  const validatedPath = detectWorktreePath(explicitWorktreePath)
  if (validatedPath) {
    return { worktreePath: validatedPath, block: createWorktreeActiveBlock(validatedPath) }
  }

  return {
    worktreePath: undefined,
    block: `\n**Worktree** (needs setup): \`git worktree add ${explicitWorktreePath} <branch>\`, then add \`"worktree_path"\` to boulder.json`,
  }
}

export function createStartWorkHook(ctx: PluginInput, sisyphusConfig?: SisyphusConfig) {
  const processStartWork = async (
    input: StartWorkHookInput,
    output: StartWorkHookOutput,
  ): Promise<void> => {
    const parts = output.parts
    const promptText =
      parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

    if (
      !promptText.includes("<session-context>")
      || !promptText.includes(START_WORK_TEMPLATE_MARKER)
    ) {
      return
    }

    log(`[${HOOK_NAME}] Processing start-work command`, { sessionID: input.sessionID })
    const currentSessionAgent = getSessionAgent(input.sessionID)
    const currentSessionAgentKey = currentSessionAgent
      ? getAgentConfigKey(currentSessionAgent)
      : undefined
    const activeAgent = currentSessionAgent
      && currentSessionAgentKey
      && currentSessionAgentKey !== "prometheus"
      && currentSessionAgentKey !== "atlas"
        ? currentSessionAgent
        : isAgentRegistered("atlas")
          ? "atlas"
          : "sisyphus"
    const activeAgentDisplayName = activeAgent === "atlas"
      ? getAgentListDisplayName(activeAgent)
      : getAgentDisplayName(activeAgent)
    updateSessionAgent(input.sessionID, activeAgent)
    if (output.message) {
      output.message["agent"] = activeAgentDisplayName
    }

    const existingState = readBoulderState(ctx.directory)
    const sessionId = input.sessionID
    const timestamp = new Date().toISOString()
    const config = getStartWorkConfig(sisyphusConfig)

    const { planName: explicitPlanName, explicitWorktreePath } = parseUserRequest(promptText)
    const { worktreePath, block: worktreeBlock } = resolveWorktreeContext(explicitWorktreePath)

    let contextInfo = ""

    if (explicitPlanName) {
      log(`[${HOOK_NAME}] Explicit plan name requested: ${explicitPlanName}`, { sessionID: input.sessionID })

      const allPlans = findPlansForStartWork({
        directory: ctx.directory,
        provider: config.planProvider,
        explicitPlanName,
        backlogAgent: config.backlogAgent,
        backlogPlanFile: config.backlogPlanFile,
      })
      const matchedPlan = findPlanByName(allPlans, explicitPlanName)

      if (matchedPlan) {
        const progress = getPlanProgress(matchedPlan)

        if (progress.isComplete) {
          contextInfo = buildPlanAlreadyCompleteMessage(matchedPlan, progress.total)
        } else {
          if (existingState) clearBoulderState(ctx.directory)
          const newState = createBoulderState(matchedPlan, sessionId, activeAgent, worktreePath)
          writeBoulderState(ctx.directory, newState)

          contextInfo = `${buildAutoSelectedPlanMessage({
            planPath: matchedPlan,
            completed: progress.completed,
            total: progress.total,
            sessionId,
            timestamp,
          })}\n${worktreeBlock}`
        }
      } else {
        const incompletePlans = allPlans.filter((p) => !getPlanProgress(p).isComplete)
        contextInfo = buildPlanNotFoundMessage(explicitPlanName, incompletePlans)
      }
    } else if (existingState) {
      const progress = getPlanProgress(existingState.active_plan)

      if (!progress.isComplete) {
        const effectiveWorktree = worktreePath ?? existingState.worktree_path
        const sessionAlreadyTracked = existingState.session_ids.includes(sessionId)
        const updatedSessions = sessionAlreadyTracked
          ? existingState.session_ids
          : [...existingState.session_ids, sessionId]
        const shouldRewriteState = existingState.agent !== activeAgent || worktreePath !== undefined

        if (shouldRewriteState) {
          writeBoulderState(ctx.directory, {
            ...existingState,
            agent: activeAgent,
            ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
            session_ids: updatedSessions,
          })
        } else if (!sessionAlreadyTracked) {
          appendSessionId(ctx.directory, sessionId)
        }

        const worktreeDisplay = effectiveWorktree ? createWorktreeActiveBlock(effectiveWorktree) : worktreeBlock

        contextInfo = `${buildResumeMessage({
          planName: existingState.plan_name,
          planPath: existingState.active_plan,
          completed: progress.completed,
          total: progress.total,
          existingSessionCount: existingState.session_ids.length,
          startedAt: existingState.started_at,
          sessionId,
        })}${worktreeDisplay}`
      } else {
        contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
      }
    }

    if (
      (!existingState && !explicitPlanName) ||
      (existingState && !explicitPlanName && getPlanProgress(existingState.active_plan).isComplete)
    ) {
      const discoveryInfo = buildDiscoveryContextInfo({
        directory: ctx.directory,
        sessionId,
        timestamp,
        planProvider: config.planProvider,
        backlogAgent: config.backlogAgent,
        backlogPlanFile: config.backlogPlanFile,
      })
      contextInfo += `\n\n${discoveryInfo}\n${worktreeBlock}`
    }

    const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
    if (idx >= 0 && output.parts[idx].text) {
      output.parts[idx].text = output.parts[idx].text
        .replace(/\$SESSION_ID/g, sessionId)
        .replace(/\$TIMESTAMP/g, timestamp)

      output.parts[idx].text += `\n\n---\n${contextInfo}`
    }

    log(`[${HOOK_NAME}] Context injected`, {
      sessionID: input.sessionID,
      hasExistingState: !!existingState,
      worktreePath,
    })
  }

  return {
    "chat.message": async (input: StartWorkHookInput, output: StartWorkHookOutput): Promise<void> => {
      await processStartWork(input, output)
    },
    "command.execute.before": async (
      input: StartWorkCommandExecuteBeforeInput,
      output: StartWorkHookOutput,
    ): Promise<void> => {
      await processStartWork(input, output)
    },
  }
}
