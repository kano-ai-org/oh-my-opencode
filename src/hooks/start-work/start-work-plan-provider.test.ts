import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findPlansForStartWork } from "./start-work-plan-provider"

describe("start-work plan provider", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `start-work-provider-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("returns resolved backlog plan via kano-backlog topic command", () => {
    const scriptPath = join(
      testDir,
      ".agents",
      "skills",
      "kano",
      "kano-agent-backlog-skill",
      "scripts",
      "kano-backlog",
    )
    mkdirSync(join(scriptPath, ".."), { recursive: true })
    writeFileSync(scriptPath, "#!/usr/bin/env python\n")

    const pythonPath = join(testDir, ".venv", "bin", "python")
    mkdirSync(join(pythonPath, ".."), { recursive: true })
    writeFileSync(pythonPath, "#!/usr/bin/env python\n")

    const resolvedPath = join(testDir, "_kano", "backlog", "topics", "my-topic", "plan.md")
    const execSpy = spyOn(childProcess, "execFileSync").mockImplementation(() =>
      JSON.stringify({ plan_path: resolvedPath, provider: "backlog" })
    )

    const result = findPlansForStartWork({
      directory: testDir,
      provider: "backlog",
      explicitPlanName: "my-topic",
      backlogAgent: "atlas",
      backlogPlanFile: "plan.md",
    })

    expect(result).toEqual([resolvedPath])
    const [, args] = execSpy.mock.calls[0] as [string, string[]]
    expect(args).toContain("topic")
    expect(args).toContain("resolve-opencode-plan")
    expect(args).toContain("my-topic")
    execSpy.mockRestore()
  })

  test("falls back to sisyphus plans in auto mode when backlog command unavailable", () => {
    const plansDir = join(testDir, ".sisyphus", "plans")
    mkdirSync(plansDir, { recursive: true })
    const planPath = join(plansDir, "legacy-plan.md")
    writeFileSync(planPath, "# Legacy Plan\n- [ ] Task")

    const result = findPlansForStartWork({
      directory: testDir,
      provider: "auto",
      explicitPlanName: null,
      backlogAgent: "atlas",
      backlogPlanFile: "plan.md",
    })

    expect(result).toContain(planPath)
  })
})
