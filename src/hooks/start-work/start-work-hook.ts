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
import { updateSessionAgent } from "../../features/claude-code-session-state"
import { getAgentDisplayName } from "../../shared/agent-display-names"
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
import { detectWorktreePath } from "./worktree-detector"

export const HOOK_NAME = "start-work" as const

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
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
    return { worktreePath: validatedPath, block: `\n**Worktree**: ${validatedPath}` }
  }

  return {
    worktreePath: undefined,
    block: `\n**Worktree** (needs setup): \`git worktree add ${explicitWorktreePath} <branch>\`, then add \`"worktree_path"\` to boulder.json`,
  }
}

export function createStartWorkHook(ctx: PluginInput, sisyphusConfig?: SisyphusConfig) {
  return {
    "chat.message": async (input: StartWorkHookInput, output: StartWorkHookOutput): Promise<void> => {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      if (!promptText.includes("<session-context>")) return

      log(`[${HOOK_NAME}] Processing start-work command`, { sessionID: input.sessionID })
      updateSessionAgent(input.sessionID, "atlas")
      if (output.message) {
        output.message["agent"] = getAgentDisplayName("atlas")
      }

      const existingState = readBoulderState(ctx.directory)
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()
      const config = getStartWorkConfig(sisyphusConfig)

      const { planName: explicitPlanName, explicitWorktreePath } = parseUserRequest(promptText)
      const { worktreePath, block: worktreeBlock } = resolveWorktreeContext(explicitWorktreePath)

      let contextInfo = ""

      if (explicitPlanName) {
        log(`[${HOOK_NAME}] Explicit plan name requested: ${explicitPlanName}`, {
          sessionID: input.sessionID,
        })

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
            const newState = createBoulderState(matchedPlan, sessionId, "atlas", worktreePath)
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
          const incompletePlans = allPlans.filter((planPath) => !getPlanProgress(planPath).isComplete)
          contextInfo = buildPlanNotFoundMessage(explicitPlanName, incompletePlans)
        }
      } else if (existingState) {
        const progress = getPlanProgress(existingState.active_plan)

        if (!progress.isComplete) {
          const effectiveWorktree = worktreePath ?? existingState.worktree_path

          if (worktreePath !== undefined) {
            const updatedSessions = existingState.session_ids.includes(sessionId)
              ? existingState.session_ids
              : [...existingState.session_ids, sessionId]
            writeBoulderState(ctx.directory, {
              ...existingState,
              worktree_path: worktreePath,
              session_ids: updatedSessions,
            })
          } else {
            appendSessionId(ctx.directory, sessionId)
          }

          const worktreeDisplay = effectiveWorktree ? `\n**Worktree**: ${effectiveWorktree}` : worktreeBlock

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
    },
  }
}
