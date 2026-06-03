import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import type { SessionState, TrackedTopLevelTaskRef } from "./types"
import {
  clearPersistedFinalWaveVerifierTimeouts,
  getFinalWaveVerifierTimeoutBlocker,
  isFinalWaveVerifierTimeoutOutput,
  readPersistedFinalWaveVerifierTimeouts,
  recordFinalWaveVerifierTimeout,
} from "./final-wave-timeout-fuse"

function writeFinalWaveOnlyPlan(planPath: string): void {
  writeFileSync(planPath, `# Plan

## TODOs
- [x] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit
- [ ] F2. Code Quality Review
`, "utf-8")
}

describe("final-wave timeout fuse", () => {
  test("detects verifier timeout output that has no verdict", () => {
    expect(isFinalWaveVerifierTimeoutOutput("F1 task session timed out before returning final verdict payload")).toBe(true)
    expect(isFinalWaveVerifierTimeoutOutput("VERDICT: APPROVE\nEverything passed")).toBe(false)
  })

  test("blocks continuation when only final-wave tasks remain after verifier timeout", () => {
    const directory = join(tmpdir(), `final-wave-timeout-fuse-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const planPath = join(directory, "plan.md")
      writeFinalWaveOnlyPlan(planPath)

      const sessionState: SessionState = { promptFailureCount: 0 }
      const task: TrackedTopLevelTaskRef = {
        key: "final-wave:f1",
        label: "F1",
        title: "Plan Compliance Audit",
      }

      recordFinalWaveVerifierTimeout({
        sessionState,
        task,
        output: "F1 task session timed out before returning final verdict payload",
        now: 123,
      })

      const blocker = getFinalWaveVerifierTimeoutBlocker({ planPath, sessionState })
      expect(blocker?.pendingFinalWaveTaskCount).toBe(2)
      expect(blocker?.timeoutCount).toBe(1)
      expect(blocker?.reason).toContain("Auto-continuation must stop")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("persists verifier timeout blockers across fresh session state", () => {
    const directory = join(tmpdir(), `final-wave-timeout-fuse-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const planPath = join(directory, "plan.md")
      writeFinalWaveOnlyPlan(planPath)

      recordFinalWaveVerifierTimeout({
        sessionState: { promptFailureCount: 0 },
        task: { key: "final-wave:f1", label: "F1", title: "Plan Compliance Audit" },
        output: "F1 task session timed out before returning final verdict payload",
        now: 123,
        directory,
        planPath,
      })

      const freshSessionState: SessionState = { promptFailureCount: 0 }
      const blocker = getFinalWaveVerifierTimeoutBlocker({
        planPath,
        sessionState: freshSessionState,
        directory,
      })
      expect(blocker?.timeoutCount).toBe(1)
      expect(blocker?.pendingFinalWaveTaskCount).toBe(2)
      expect(blocker?.reason).toContain("Auto-continuation must stop")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not double count the same timeout record from memory and persistence", () => {
    const directory = join(tmpdir(), `final-wave-timeout-fuse-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const planPath = join(directory, "plan.md")
      writeFinalWaveOnlyPlan(planPath)
      const sessionState: SessionState = { promptFailureCount: 0 }

      recordFinalWaveVerifierTimeout({
        sessionState,
        task: { key: "final-wave:f1", label: "F1", title: "Plan Compliance Audit" },
        output: "F1 task session timed out before returning final verdict payload",
        now: 123,
        directory,
        planPath,
      })

      const blocker = getFinalWaveVerifierTimeoutBlocker({ planPath, sessionState, directory })
      expect(blocker?.timeoutCount).toBe(1)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("clears persisted verifier timeout blocker when a real user explicitly resumes", () => {
    const directory = join(tmpdir(), `final-wave-timeout-fuse-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const planPath = join(directory, "plan.md")
      writeFinalWaveOnlyPlan(planPath)

      recordFinalWaveVerifierTimeout({
        sessionState: { promptFailureCount: 0 },
        task: { key: "final-wave:f1", label: "F1", title: "Plan Compliance Audit" },
        output: "F1 task session timed out before returning final verdict payload",
        now: 123,
        directory,
        planPath,
      })

      expect(Object.keys(readPersistedFinalWaveVerifierTimeouts({ directory, planPath }))).toEqual(["final-wave:f1"])
      clearPersistedFinalWaveVerifierTimeouts({ directory, planPath })
      expect(readPersistedFinalWaveVerifierTimeouts({ directory, planPath })).toEqual({})
      expect(existsSync(join(directory, ".sisyphus", "final-wave-verifier-timeouts.json"))).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not block while implementation tasks remain", () => {
    const directory = join(tmpdir(), `final-wave-timeout-fuse-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    try {
      const planPath = join(directory, "plan.md")
      writeFileSync(planPath, `# Plan

## TODOs
- [ ] 1. Ship implementation

## Final Verification Wave (MANDATORY - after ALL implementation tasks)
- [ ] F1. Plan Compliance Audit
`, "utf-8")

      const sessionState: SessionState = { promptFailureCount: 0 }
      recordFinalWaveVerifierTimeout({
        sessionState,
        task: { key: "final-wave:f1", label: "F1", title: "Plan Compliance Audit" },
        output: "F1 task session timed out before returning final verdict payload",
        now: 123,
      })

      expect(getFinalWaveVerifierTimeoutBlocker({ planPath, sessionState })).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
