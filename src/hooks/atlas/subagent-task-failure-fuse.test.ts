import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { SessionState, TrackedTopLevelTaskRef } from "./types"
import {
  classifySubagentTaskFailureOutput,
  getSubagentTaskFailureBlocker,
  readPersistedSubagentTaskFailures,
  recordSubagentTaskFailure,
} from "./subagent-task-failure-fuse"

function writePlan(planPath: string, options?: { task1Checked?: boolean; task2Checked?: boolean }): void {
  writeFileSync(planPath, `# Plan

## TODOs
- [${options?.task1Checked ? "x" : " "}] 1. Run Final Verification Wave reviewers F1-F4 in parallel
- [${options?.task2Checked ? "x" : " "}] 2. Present consolidated results

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit
`, "utf-8")
}

function createTempPlan(): { directory: string; planPath: string } {
  const directory = join(tmpdir(), `subagent-task-failure-fuse-${randomUUID()}`)
  mkdirSync(directory, { recursive: true })
  const planPath = join(directory, "plan.md")
  writePlan(planPath)
  return { directory, planPath }
}

const task: TrackedTopLevelTaskRef = {
  key: "todo:1",
  label: "1",
  title: "Run Final Verification Wave reviewers F1-F4 in parallel",
}

describe("subagent task failure fuse", () => {
  test("classifies poll timeout output", () => {
    const classified = classifySubagentTaskFailureOutput(
      "Poll timeout reached after 1800000ms for session ses_175950183ffeP2eI503XonVRXq",
    )
    expect(classified?.kind).toBe("poll_timeout")
    expect(classified?.sessionID).toBe("ses_175950183ffeP2eI503XonVRXq")
  })

  test("classifies empty subagent completion marker", () => {
    const classified = classifySubagentTaskFailureOutput("SUBAGENT_EMPTY_COMPLETION\nfinish: unknown\ntokens: 0")
    expect(classified?.kind).toBe("empty_completion")
  })

  test("classifies missing required skills as terminal failure", () => {
    const classified = classifySubagentTaskFailureOutput("Skills not found: customize-opencode, kano-skill-dev-convention")
    expect(classified?.kind).toBe("missing_required_skills")
  })

  test("persists terminal subagent failure and blocks fresh continuation state", () => {
    const { directory, planPath } = createTempPlan()
    try {
      const sessionState: SessionState = { promptFailureCount: 0 }
      const classification = classifySubagentTaskFailureOutput(
        "Poll timeout reached after 1800000ms for session ses_timeout",
      )
      if (!classification) throw new Error("expected classification")

      recordSubagentTaskFailure({
        sessionState,
        task,
        classification,
        output: "Poll timeout reached after 1800000ms for session ses_timeout",
        now: 123,
        directory,
        planPath,
      })

      expect(Object.keys(readPersistedSubagentTaskFailures({ directory, planPath }))).toEqual(["todo:1"])

      const freshSessionState: SessionState = { promptFailureCount: 0 }
      const blocker = getSubagentTaskFailureBlocker({ directory, planPath, sessionState: freshSessionState })
      expect(blocker?.failureCount).toBe(1)
      expect(blocker?.failedTaskCount).toBe(1)
      expect(blocker?.reason).toContain("Auto-continuation stopped")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not block after the failed top-level task is checked off", () => {
    const { directory, planPath } = createTempPlan()
    try {
      const classification = classifySubagentTaskFailureOutput(
        "Poll timeout reached after 1800000ms for session ses_timeout",
      )
      if (!classification) throw new Error("expected classification")
      const sessionState: SessionState = { promptFailureCount: 0 }
      recordSubagentTaskFailure({
        sessionState,
        task,
        classification,
        output: "Poll timeout reached after 1800000ms for session ses_timeout",
        now: 123,
        directory,
        planPath,
      })

      writePlan(planPath, { task1Checked: true })

      expect(getSubagentTaskFailureBlocker({ directory, planPath, sessionState })).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
