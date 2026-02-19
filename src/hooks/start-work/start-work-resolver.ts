import {
  createBoulderState,
  getPlanName,
  getPlanProgress,
  writeBoulderState,
} from "../../features/boulder-state"
import type { SisyphusConfig } from "../../config"
import {
  buildAllPlansCompleteMessage,
  buildAutoSelectedPlanMessage,
  buildMultiplePlansMessage,
  buildNoPlansFoundMessage,
} from "./start-work-context-messages"
import { findPlansForStartWork } from "./start-work-plan-provider"

const KEYWORD_PATTERN = /\b(ultrawork|ulw)\b/gi

export function extractUserRequestPlanName(promptText: string): string | null {
  const userRequestMatch = promptText.match(/<user-request>\s*([\s\S]*?)\s*<\/user-request>/i)
  if (!userRequestMatch) return null

  const rawArg = userRequestMatch[1].trim()
  if (!rawArg) return null

  const cleanedArg = rawArg.replace(KEYWORD_PATTERN, "").trim()
  return cleanedArg || null
}

export function findPlanByName(plans: string[], requestedName: string): string | null {
  const lowerName = requestedName.toLowerCase()
  const exactMatch = plans.find((planPath) => getPlanName(planPath).toLowerCase() === lowerName)
  if (exactMatch) return exactMatch
  return plans.find((planPath) => getPlanName(planPath).toLowerCase().includes(lowerName)) ?? null
}

export function getStartWorkConfig(sisyphusConfig?: SisyphusConfig) {
  return {
    planProvider: sisyphusConfig?.plan_provider ?? "auto",
    backlogAgent: sisyphusConfig?.backlog_topic_agent ?? "atlas",
    backlogPlanFile: sisyphusConfig?.backlog_topic_plan_file ?? "plan.md",
  }
}

export function buildDiscoveryContextInfo(params: {
  directory: string
  sessionId: string
  timestamp: string
  planProvider: "backlog" | "sisyphus" | "auto"
  backlogAgent: string
  backlogPlanFile: string
}): string {
  const plans = findPlansForStartWork({
    directory: params.directory,
    provider: params.planProvider,
    explicitPlanName: null,
    backlogAgent: params.backlogAgent,
    backlogPlanFile: params.backlogPlanFile,
  })
  const incompletePlans = plans.filter((planPath) => !getPlanProgress(planPath).isComplete)

  if (plans.length === 0) return buildNoPlansFoundMessage()
  if (incompletePlans.length === 0) return buildAllPlansCompleteMessage(plans.length)

  if (incompletePlans.length === 1) {
    const planPath = incompletePlans[0]
    const progress = getPlanProgress(planPath)
    const newState = createBoulderState(planPath, params.sessionId, "atlas")
    writeBoulderState(params.directory, newState)
    return buildAutoSelectedPlanMessage({
      planPath,
      completed: progress.completed,
      total: progress.total,
      sessionId: params.sessionId,
      timestamp: params.timestamp,
    })
  }

  const plansForMessage = incompletePlans.map((planPath) => {
    const progress = getPlanProgress(planPath)
    const stat = require("node:fs").statSync(planPath)
    return {
      planName: getPlanName(planPath),
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      progress: `${progress.completed}/${progress.total}`,
    }
  })

  return buildMultiplePlansMessage({
    sessionId: params.sessionId,
    timestamp: params.timestamp,
    plans: plansForMessage,
  })
}
