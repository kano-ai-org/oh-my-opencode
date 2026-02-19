import type { PluginInput } from "@opencode-ai/plugin"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  getPlanProgress,
  createBoulderState,
  clearBoulderState,
} from "../../features/boulder-state"
import type { SisyphusConfig } from "../../config"
import { log } from "../../shared/logger"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import {
  buildAutoSelectedPlanMessage,
  buildPlanAlreadyCompleteMessage,
  buildPlanNotFoundMessage,
  buildResumeMessage,
} from "./start-work-context-messages"
import { findPlansForStartWork } from "./start-work-plan-provider"
import {
  buildDiscoveryContextInfo,
  extractUserRequestPlanName,
  findPlanByName,
  getStartWorkConfig,
} from "./start-work-resolver"

export const HOOK_NAME = "start-work" as const

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkHookOutput {
  parts: Array<{ type: string; text?: string }>
}

export function createStartWorkHook(ctx: PluginInput, sisyphusConfig?: SisyphusConfig) {
  return {
    "chat.message": async (
      input: StartWorkHookInput,
      output: StartWorkHookOutput
    ): Promise<void> => {
      const parts = output.parts
      const promptText = parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

      // Only trigger on actual command execution (contains <session-context> tag)
      // NOT on description text like "Start Sisyphus work session from Prometheus plan"
      const isStartWorkCommand = promptText.includes("<session-context>")

      if (!isStartWorkCommand) {
        return
      }

      log(`[${HOOK_NAME}] Processing start-work command`, {
        sessionID: input.sessionID,
      })

      updateSessionAgent(input.sessionID, "atlas") // Always switch: fixes #1298

      const existingState = readBoulderState(ctx.directory)
      const sessionId = input.sessionID
      const timestamp = new Date().toISOString()
      const config = getStartWorkConfig(sisyphusConfig)

      let contextInfo = ""
      
      const explicitPlanName = extractUserRequestPlanName(promptText)
      
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
            if (existingState) {
              clearBoulderState(ctx.directory)
            }
            const newState = createBoulderState(matchedPlan, sessionId, "atlas")
            writeBoulderState(ctx.directory, newState)
            contextInfo = buildAutoSelectedPlanMessage({
              planPath: matchedPlan,
              completed: progress.completed,
              total: progress.total,
              sessionId,
              timestamp,
            })
          }
        } else {
          const incompletePlans = allPlans.filter(p => !getPlanProgress(p).isComplete)
          contextInfo = buildPlanNotFoundMessage(explicitPlanName, incompletePlans)
        }
      } else if (existingState) {
        const progress = getPlanProgress(existingState.active_plan)
        
        if (!progress.isComplete) {
          appendSessionId(ctx.directory, sessionId)
          contextInfo = buildResumeMessage({
            planName: existingState.plan_name,
            planPath: existingState.active_plan,
            completed: progress.completed,
            total: progress.total,
            existingSessionCount: existingState.session_ids.length,
            startedAt: existingState.started_at,
            sessionId,
          })
        } else {
          contextInfo = `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
        }
      }

      if ((!existingState && !explicitPlanName) || (existingState && !explicitPlanName && getPlanProgress(existingState.active_plan).isComplete)) {
        const discoveryInfo = buildDiscoveryContextInfo({
          directory: ctx.directory,
          sessionId,
          timestamp,
          planProvider: config.planProvider,
          backlogAgent: config.backlogAgent,
          backlogPlanFile: config.backlogPlanFile,
        })
        contextInfo += `\n\n${discoveryInfo}`
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
      })
    },
  }
}
