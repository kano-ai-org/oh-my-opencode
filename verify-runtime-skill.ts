import { getAllSkills } from "./src/features/opencode-skill-loader/skill-content"
import { matchSkillByName } from "./src/tools/skill/skill-matcher"

const skills = await getAllSkills()
console.log("COUNT", skills.length)
for (const name of ["kano-git-master-skill", "kano-shell-master-skill", "kano-system-prompt-skill"]) {
  const matched = matchSkillByName(skills, name)
  console.log(name, "=>", matched?.name ?? "NOT_FOUND")
}
