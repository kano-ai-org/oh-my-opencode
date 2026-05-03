/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import { matchSkillByName } from "./skill-matcher"

function createSkill(name: string): LoadedSkill {
  return {
    name,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `Test skill template for ${name}`,
    },
    scope: "config",
  }
}

describe("matchSkillByName", () => {
  it("matches exact Kano skills before using Kano meta fallback", () => {
    // given
    const skills = [
      createSkill("kano-skills-meta"),
      createSkill("kano-shell-master-skill"),
    ]

    // when
    const matched = matchSkillByName(skills, "kano-shell-master-skill")

    // then
    expect(matched?.name).toBe("kano-shell-master-skill")
  })

  it("matches a unique nested skill short name before using Kano meta fallback", () => {
    // given
    const skills = [
      createSkill("kano-skills-meta"),
      createSkill("kano/kano-shell-master-skill"),
    ]

    // when
    const matched = matchSkillByName(skills, "kano-shell-master-skill")

    // then
    expect(matched?.name).toBe("kano/kano-shell-master-skill")
  })

  it("falls back to Kano meta skill for namespaced Kano nested skill requests", () => {
    // given
    const skills = [createSkill("kano-skills-meta")]

    // when
    const matched = matchSkillByName(skills, "kano/kano-jenkins-skill")

    // then
    expect(matched?.name).toBe("kano-skills-meta")
  })

  it("falls back to Kano meta skill when only the umbrella skill is available", () => {
    // given
    const skills = [createSkill("kano-skills-meta")]

    // when
    const matched = matchSkillByName(skills, "kano-jenkins-skill")

    // then
    expect(matched?.name).toBe("kano-skills-meta")
  })

  it("falls back to Kano meta skill case-insensitively", () => {
    // given
    const skills = [createSkill("kano-skills-meta")]

    // when
    const matched = matchSkillByName(skills, "KANO-JENKINS-SKILL")

    // then
    expect(matched?.name).toBe("kano-skills-meta")
  })

  it("does not fall back Kano nested skill requests when Kano meta is unavailable", () => {
    // given
    const skills = [createSkill("git-master")]

    // when
    const matched = matchSkillByName(skills, "kano-jenkins-skill")

    // then
    expect(matched).toBeUndefined()
  })

  it("does not fall back non-Kano missing skills to Kano meta", () => {
    // given
    const skills = [createSkill("kano-skills-meta")]

    // when
    const matched = matchSkillByName(skills, "missing-skill")

    // then
    expect(matched).toBeUndefined()
  })
})
