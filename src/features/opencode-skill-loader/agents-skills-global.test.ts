import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

const TEST_DIR = join(tmpdir(), "agents-global-skills-test-" + Date.now())
const TEMP_HOME = join(TEST_DIR, "home")

describe("discoverGlobalAgentsSkills", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEMP_HOME, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("#given a skill in ~/.agents/skills/ #when discoverGlobalAgentsSkills is called #then it discovers the skill", async () => {
    //#given
    const skillContent = `---
name: agent-global-skill
description: A skill from global .agents/skills directory
---
Skill body.
`
    const agentsGlobalSkillsDir = join(TEMP_HOME, ".agents", "skills")
    const skillDir = join(agentsGlobalSkillsDir, "agent-global-skill")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), skillContent)

    mock.module("os", () => ({
      homedir: () => TEMP_HOME,
      tmpdir,
    }))

    //#when
    const { discoverGlobalAgentsSkills } = await import("./loader")
    const skills = await discoverGlobalAgentsSkills()
    const skill = skills.find(s => s.name === "agent-global-skill")

    //#then
    expect(skill).toBeDefined()
    expect(skill?.scope).toBe("user")
    expect(skill?.definition.description).toContain("A skill from global .agents/skills directory")
  })

  it("#given grouped Kano skills in ~/.agents/skills/kano/ #when discoverGlobalAgentsSkills is called #then it discovers the meta skill and nested skills", async () => {
    //#given
    const agentsGlobalSkillsDir = join(TEMP_HOME, ".agents", "skills")
    const kanoDir = join(agentsGlobalSkillsDir, "kano")
    const jenkinsDir = join(kanoDir, "kano-jenkins-skill")
    mkdirSync(jenkinsDir, { recursive: true })
    writeFileSync(
      join(kanoDir, "SKILL.md"),
      `---
name: kano-skills-meta
description: Kano skills umbrella
---
Kano meta body.
`,
    )
    writeFileSync(
      join(jenkinsDir, "SKILL.md"),
      `---
name: kano-jenkins-skill
description: Jenkins CI orchestration
---
Jenkins skill body.
`,
    )

    mock.module("os", () => ({
      homedir: () => TEMP_HOME,
      tmpdir,
    }))

    //#when
    const { discoverGlobalAgentsSkills } = await import(`./loader?test=${Date.now()}-${Math.random()}`)
    const skills = await discoverGlobalAgentsSkills()

    //#then
    expect(skills.map((skill) => skill.name).sort()).toContain("kano-skills-meta")
    expect(skills.map((skill) => skill.name).sort()).toContain("kano/kano-jenkins-skill")
    expect(skills.find((skill) => skill.name === "kano/kano-jenkins-skill")?.scope).toBe("user")
  })
})
