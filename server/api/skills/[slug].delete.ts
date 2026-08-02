import { rm } from 'node:fs/promises'
import { findSkill } from '../../utils/findSkill'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const found = await findSkill(event, slug)

  if (!found) {
    throw createError({ statusCode: 404, message: `Skill not found: ${slug}` })
  }

  if (found.source !== 'local') {
    throw createError({
      statusCode: 400,
      message: `"${slug}" comes from ${found.source === 'plugin' ? `the ${found.pluginName} plugin` : 'a GitHub import'} — remove it from its source instead.`,
    })
  }

  try {
    await rm(found.dir, { recursive: true })
  } catch {
    throw createError({ statusCode: 500, message: `Failed to delete skill: ${slug}` })
  }

  return { deleted: true, slug, scope: found.scope }
})
