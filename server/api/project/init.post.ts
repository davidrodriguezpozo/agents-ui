import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getProjectDir } from '../../utils/scope'

/** Scaffold `<project>/.claude` so the project scope has somewhere to write. */
export default defineEventHandler(async (event) => {
  const projectDir = getProjectDir(event)

  if (!projectDir) {
    throw createError({
      statusCode: 400,
      message: 'No project directory selected, or the path does not exist.',
    })
  }

  const claudeDir = join(projectDir, '.claude')
  const created = !existsSync(claudeDir)

  for (const sub of ['agents', 'commands', 'skills', 'workflows']) {
    await mkdir(join(claudeDir, sub), { recursive: true })
  }

  return { created, projectDir, claudeDir }
})
