import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { loadSkillsFromDir } from "./skill-directory-loader"
import { matchSkillByName } from "../../tools/skill/skill-matcher"

const dirs: string[] = []

async function temp() {
  const dir = await mkdtemp(join(tmpdir(), "omo-skill-dir-"))
  dirs.push(dir)
  return dir
}

async function skill(dir: string, content: string, file = "SKILL.md") {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, file), content)
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("loadSkillsFromDir", () => {
  it("keeps recursing when a parent directory has SKILL.md", async () => {
    const root = await temp()
    const group = join(root, "kano")
    const child = join(group, "kano-agent-backlog-skill")

    await skill(
      group,
      `---
name: kano-skills-meta
description: Meta skill
---

Meta skill body.
`,
    )
    await skill(
      child,
      `---
name: kano-agent-backlog-skill
description: Backlog skill
---

Backlog skill body.
`,
    )

    const list = await loadSkillsFromDir({ skillsDir: root, scope: "user" })

    expect(list.map((item) => item.name).sort()).toEqual([
      "kano-skills-meta",
      "kano/kano-agent-backlog-skill",
    ])
    expect(matchSkillByName(list, "kano-agent-backlog-skill")?.name).toBe(
      "kano/kano-agent-backlog-skill",
    )
  })

  it("keeps recursing when a parent directory has a same-name markdown skill", async () => {
    const root = await temp()
    const group = join(root, "vendor")
    const child = join(group, "nested-skill")

    await skill(
      group,
      `---
name: vendor-meta
description: Vendor meta skill
---

Vendor skill body.
`,
      "vendor.md",
    )
    await skill(
      child,
      `---
name: nested-skill
description: Nested skill
---

Nested skill body.
`,
    )

    const list = await loadSkillsFromDir({ skillsDir: root, scope: "user" })

    expect(list.map((item) => item.name).sort()).toEqual([
      "vendor-meta",
      "vendor/nested-skill",
    ])
  })
})
