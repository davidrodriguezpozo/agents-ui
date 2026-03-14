import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { resolveClaudePath } from '../../utils/claudeDir'
import { parseFrontmatter } from '../../utils/frontmatter'
import type { Skill, SkillFrontmatter } from '~/types'

export default defineEventHandler(async () => {
  const skillsDir = resolveClaudePath('skills')
  if (!existsSync(skillsDir)) return []

  const entries = await readdir(skillsDir, { withFileTypes: true })
  const skillDirs = entries.filter(e => e.isDirectory())

  const skills: Skill[] = (await Promise.all(
    skillDirs.map(async (dir) => {
      const skillPath = join(skillsDir, dir.name, 'SKILL.md')
      if (!existsSync(skillPath)) return null

      const raw = await readFile(skillPath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<SkillFrontmatter>(raw)

      return {
        slug: dir.name,
        frontmatter: { name: dir.name, ...frontmatter },
        body,
        filePath: skillPath,
      }
    })
  )).filter(Boolean) as Skill[]

  return skills.sort((a, b) => a.slug.localeCompare(b.slug))
})
