import { getPlanName } from "../../features/boulder-state"

export function buildPlanAlreadyCompleteMessage(planPath: string, total: number): string {
  return [
    "## Plan Already Complete",
    "",
    `The requested plan \"${getPlanName(planPath)}\" has been completed.`,
    `All ${total} tasks are done. Create a new plan with: /plan \"your task\"`,
  ].join("\n")
}

export function buildAutoSelectedPlanMessage(params: {
  planPath: string
  completed: number
  total: number
  sessionId: string
  timestamp: string
}): string {
  const { planPath, completed, total, sessionId, timestamp } = params
  return [
    "## Auto-Selected Plan",
    "",
    `**Plan**: ${getPlanName(planPath)}`,
    `**Path**: ${planPath}`,
    `**Progress**: ${completed}/${total} tasks`,
    `**Session ID**: ${sessionId}`,
    `**Started**: ${timestamp}`,
    "",
    "boulder.json has been created. Read the plan and begin execution.",
  ].join("\n")
}

export function buildPlanNotFoundMessage(explicitPlanName: string, incompletePlans: string[]): string {
  if (incompletePlans.length === 0) {
    return [
      "## Plan Not Found",
      "",
      `Could not find a plan matching \"${explicitPlanName}\".`,
      "No incomplete plans available. Create a new plan with: /plan \"your task\"",
    ].join("\n")
  }

  const planList = incompletePlans.map((planPath, i) => `${i + 1}. [${getPlanName(planPath)}]`).join("\n")
  return [
    "## Plan Not Found",
    "",
    `Could not find a plan matching \"${explicitPlanName}\".`,
    "",
    "Available incomplete plans:",
    planList,
    "",
    "Ask the user which plan to work on.",
  ].join("\n")
}

export function buildResumeMessage(params: {
  planName: string
  planPath: string
  completed: number
  total: number
  existingSessionCount: number
  startedAt: string
  sessionId: string
}): string {
  const { planName, planPath, completed, total, existingSessionCount, startedAt, sessionId } = params
  return [
    "## Active Work Session Found",
    "",
    "**Status**: RESUMING existing work",
    `**Plan**: ${planName}`,
    `**Path**: ${planPath}`,
    `**Progress**: ${completed}/${total} tasks completed`,
    `**Sessions**: ${existingSessionCount + 1} (current session appended)`,
    `**Started**: ${startedAt}`,
    "",
    `The current session (${sessionId}) has been added to session_ids.`,
    "Read the plan file and continue from the first unchecked task.",
  ].join("\n")
}

export function buildNoPlansFoundMessage(): string {
  return [
    "## No Plans Found",
    "",
    "No plan files were found from configured providers.",
    'Use Prometheus to create a work plan first: /plan "your task"',
  ].join("\n")
}

export function buildAllPlansCompleteMessage(planCount: number): string {
  return [
    "## All Plans Complete",
    "",
    `All ${planCount} plan(s) are complete. Create a new plan with: /plan \"your task\"`,
  ].join("\n")
}

export function buildMultiplePlansMessage(params: {
  sessionId: string
  timestamp: string
  plans: Array<{ planName: string; modifiedAt: string; progress: string }>
}): string {
  const list = params.plans
    .map((plan, i) => `${i + 1}. [${plan.planName}] - Modified: ${plan.modifiedAt} - Progress: ${plan.progress}`)
    .join("\n")

  return [
    "<system-reminder>",
    "## Multiple Plans Found",
    "",
    `Current Time: ${params.timestamp}`,
    `Session ID: ${params.sessionId}`,
    "",
    list,
    "",
    "Ask the user which plan to work on. Present the options above and wait for their response.",
    "</system-reminder>",
  ].join("\n")
}
