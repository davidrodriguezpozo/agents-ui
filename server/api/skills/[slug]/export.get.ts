import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { findSkill } from '../../../utils/findSkill'
import { listSkillFiles } from '../../../utils/skillFiles'
import { createZip, type ZipEntry } from '../../../utils/zip'

/**
 * Download a skill.
 *
 * Two things were wrong here before. It resolved the path itself with
 * `resolveClaudePath`, so a project-scoped skill, a plugin's, or a GitHub
 * import's could not be exported at all — the download 404'd on a skill the
 * page it came from was displaying. And it only ever sent SKILL.md, so
 * exporting a skill with `references/` handed you the half that says "see
 * references/api.md" and not the file it refers to.
 *
 * A skill with nothing beside SKILL.md still comes down as one `.md` file. That
 * is the common case and being handed a zip containing a single file, to
 * unpack in order to read one page of markdown, would be worse for it.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const found = await findSkill(event, slug)

  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  const files = await listSkillFiles(found.dir)

  if (!files.length) {
    const content = await readFile(found.skillPath, 'utf-8')

    setResponseHeaders(event, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.md"`,
    })

    return content
  }

  // Named entries sit under `<slug>/` so unpacking produces the directory a
  // skill has to be, ready to drop into a `skills/` folder as it is.
  const entries: ZipEntry[] = [
    { path: `${slug}/SKILL.md`, data: await readFile(found.skillPath) },
  ]

  for (const file of files) {
    entries.push({
      path: `${slug}/${file.path.split(sep).join('/')}`,
      // A directory entry carries no data — that is what marks it as one, and
      // it is why an empty `scripts/` the author made on purpose survives.
      data: file.kind === 'directory' ? undefined : await readFile(join(found.dir, file.path)),
    })
  }

  const archive = createZip(entries)

  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug}.zip"`,
    'Content-Length': String(archive.length),
  })

  return archive
})
