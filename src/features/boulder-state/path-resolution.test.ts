import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BOULDER_STATE_PATH_ENV } from "./constants"
import { readBoulderState, writeBoulderState } from "./storage"
import type { BoulderState } from "./types"

describe("boulder state path resolution", () => {
  let testDir: string
  const previousEnv = process.env[BOULDER_STATE_PATH_ENV]

  beforeEach(() => {
    testDir = join(tmpdir(), `boulder-path-${Date.now()}-${Math.random()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env[BOULDER_STATE_PATH_ENV]
    } else {
      process.env[BOULDER_STATE_PATH_ENV] = previousEnv
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  test("writes state to configured non-sisyphus path", () => {
    process.env[BOULDER_STATE_PATH_ENV] = "_kano/backlog/runtime/boulder.json"

    const state: BoulderState = {
      active_plan: "/tmp/plan.md",
      started_at: new Date().toISOString(),
      session_ids: ["ses-1"],
      plan_name: "plan",
    }

    const success = writeBoulderState(testDir, state)
    const customPath = join(testDir, "_kano", "backlog", "runtime", "boulder.json")

    expect(success).toBe(true)
    expect(existsSync(customPath)).toBe(true)
    expect(existsSync(join(testDir, ".sisyphus", "boulder.json"))).toBe(false)
  })

  test("reads legacy sisyphus state as fallback when custom path is empty", () => {
    process.env[BOULDER_STATE_PATH_ENV] = "_kano/backlog/runtime/boulder.json"

    const legacyPath = join(testDir, ".sisyphus", "boulder.json")
    mkdirSync(join(legacyPath, ".."), { recursive: true })
    writeFileSync(
      legacyPath,
      JSON.stringify({
        active_plan: "/tmp/legacy.md",
        started_at: "2026-02-20T00:00:00.000Z",
        session_ids: ["ses-legacy"],
        plan_name: "legacy",
      }),
    )

    const result = readBoulderState(testDir)
    expect(result?.active_plan).toBe("/tmp/legacy.md")
    expect(result?.plan_name).toBe("legacy")
  })
})
