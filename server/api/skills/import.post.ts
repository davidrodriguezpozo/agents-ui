import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestScope, resolveForRequest } from '../../utils/scope'
import { parseFrontmatter, serializeFrontmatter } from '../../utils/frontmatter'
import { SKILL_FILE, normalizeImportPaths, writeSkillFile } from '../../utils/skillFiles'
import type { SkillFrontmatter } from '~/types'

/**
 * Import a skill from a file, or from the folder a skill actually is.
 *
 * Two payloads, because both are things people have on disk:
 *
 *   - `{ content }` — one SKILL.md, the old shape, still the quick way in.
 *   - `{ files: [{ path, content, encoding? }] }` — a whole directory, which is
 *     the only way to bring a skill that defers to `references/` or `scripts/`.
 *     Importing just its SKILL.md gave you a skill whose instructions referred
 *     to files that were not there.
 *
 * It also used to resolve straight into the user scope with `resolveClaudePath`,
 * ignoring the project the request came from — so importing a skill while a
 * project was selected put it somewhere other than where the page said, and
 * `POST /api/skills` right next door had always got this right.
 */

interface ImportFile {
  path: string
  content: string
  /** `base64` for anything that is not text. */
  encoding?: 'utf-8' | 'base64'
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ content?: string; files?: ImportFile[] }>(event)
  const scope = getRequestScope(event)

  const files = normalizeImportPaths(body.files)
  const skillMd = files.find(f => f.path === SKILL_FILE)?.content ?? body.content

  if (!skillMd?.trim()) {
    throw createError({
      statusCode: 400,
      message: files.length
        ? `That folder has no ${SKILL_FILE} in it — a skill is a directory with one at its root.`
        : 'File content is required',
    })
  }

  const { frontmatter, body: instructions } = parseFrontmatter<SkillFrontmatter>(skillMd)

  if (!frontmatter.name) {
    throw createError({ statusCode: 400, message: 'Skill file must have a name in frontmatter' })
  }

  const slug = frontmatter.name
  const skillDir = resolveForRequest(event, 'skills', slug)

  if (existsSync(skillDir)) {
    throw createError({ statusCode: 409, message: `Skill "${slug}" already exists` })
  }

  await mkdir(skillDir, { recursive: true })

  const skillPath = join(skillDir, SKILL_FILE)
  const supporting = files.filter(f => f.path !== SKILL_FILE)

  /**
   * All of it or none of it.
   *
   * The instructions are written first and the rest follows, so a folder with
   * one bad path in it — refused, correctly, by `writeSkillFile` — used to leave
   * a directory containing nothing but a SKILL.md that referred to files which
   * were never written. That is a listed, broken skill created by an import the
   * app reported as failed, and retrying it then hit "already exists".
   */
  try {
    await writeFile(skillPath, serializeFrontmatter(frontmatter, instructions), 'utf-8')

    // Written through `writeSkillFile` rather than straight to disk: these paths
    // came out of a request, and it is the thing that refuses one climbing out
    // of the directory it is supposed to be filling.
    for (const file of supporting) {
      const data = file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64')
        : file.content
      await writeSkillFile(skillDir, file.path, data)
    }
  } catch (error) {
    await rm(skillDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }

  return {
    slug,
    frontmatter,
    body: instructions,
    filePath: skillPath,
    source: 'local' as const,
    scope,
    imported: supporting.length + 1,
  }
})
