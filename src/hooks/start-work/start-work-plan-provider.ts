import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { findPrometheusPlans } from "../../features/boulder-state"

export type StartWorkPlanProvider = "backlog" | "sisyphus" | "auto"

interface ResolveBacklogPlanParams {
  directory: string
  provider: StartWorkPlanProvider
  topicName?: string
  agent: string
  planFile: string
}

interface ResolvePlanResult {
  planPath: string
  provider: "backlog" | "sisyphus"
}

function resolvePythonCommand(directory: string): string | null {
  const localUnix = join(directory, ".venv", "bin", "python")
  if (existsSync(localUnix)) return localUnix

  const localWin = join(directory, ".venv", "Scripts", "python.exe")
  if (existsSync(localWin)) return localWin

  return null
}

function resolveBacklogScript(directory: string): string | null {
  const candidates = [
    join(
      directory,
      ".agents",
      "kano",
      "kano-agent-backlog-skill",
      "scripts",
      "kano-backlog",
    ),
    join(
      directory,
      ".agents",
      "skills",
      "kano",
      "kano-agent-backlog-skill",
      "scripts",
      "kano-backlog",
    ),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function parseResolvedPlan(stdout: string): ResolvePlanResult | null {
  try {
    const parsed = JSON.parse(stdout) as { plan_path?: unknown; provider?: unknown }
    if (typeof parsed.plan_path !== "string") return null
    const provider = parsed.provider === "sisyphus" ? "sisyphus" : "backlog"
    return { planPath: parsed.plan_path, provider }
  } catch {
    return null
  }
}

function resolveBacklogPlan(params: ResolveBacklogPlanParams): ResolvePlanResult | null {
  const script = resolveBacklogScript(params.directory)
  if (!script) return null

  const pythonCandidates = [resolvePythonCommand(params.directory), "python3", "python"].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  )

  for (const pythonCmd of pythonCandidates) {
    const args = [
      script,
      "topic",
      "resolve-opencode-plan",
      "--agent",
      params.agent,
      "--plan-file",
      params.planFile,
      "--provider",
      params.provider,
      "--oh-my-opencode",
      "--format",
      "json",
    ]
    if (params.topicName) {
      args.splice(3, 0, params.topicName)
    }

    try {
      const stdout = execFileSync(pythonCmd, args, {
        cwd: params.directory,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      const resolved = parseResolvedPlan(stdout)
      if (resolved) {
        return resolved
      }
    } catch {
      continue
    }
  }

  return null
}

function filterSisyphusPlansByName(plans: string[], requestedName: string): string[] {
  const lowerName = requestedName.toLowerCase()
  return plans.filter((planPath) => {
    const planName = planPath.split(/[\\/]/).pop()?.replace(/\.md$/i, "") ?? ""
    return planName.toLowerCase() === lowerName || planName.toLowerCase().includes(lowerName)
  })
}

export function findPlansForStartWork(params: {
  directory: string
  provider: StartWorkPlanProvider
  explicitPlanName: string | null
  backlogAgent: string
  backlogPlanFile: string
}): string[] {
  const { directory, provider, explicitPlanName, backlogAgent, backlogPlanFile } = params

  if (provider !== "sisyphus") {
    const backlogResolved = resolveBacklogPlan({
      directory,
      provider,
      topicName: explicitPlanName ?? undefined,
      agent: backlogAgent,
      planFile: backlogPlanFile,
    })
    if (backlogResolved?.planPath) {
      return [backlogResolved.planPath]
    }
    if (provider === "backlog") {
      return []
    }
  }

  const sisyphusPlans = findPrometheusPlans(directory)
  if (!explicitPlanName) {
    return sisyphusPlans
  }

  return filterSisyphusPlansByName(sisyphusPlans, explicitPlanName)
}
