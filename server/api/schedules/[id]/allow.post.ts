import { describeRecurrence, readSchedules, upsertSchedule } from '../../../utils/schedules'
import { mergeRules, parseRule, removeRule } from '../../../utils/permissionRules'

/**
 * Grant or revoke permanent permission rules for a ritual.
 *
 * This is the answer to "a scheduled run needed approval and nobody was there":
 * approve what it actually needed, once, instead of raising the whole ritual to
 * unrestricted access.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ add?: string[]; remove?: string }>(event)

  const schedules = await readSchedules()
  const schedule = schedules.find(s => s.id === id)
  if (!schedule) {
    throw createError({ statusCode: 404, message: `Ritual not found: ${id}` })
  }

  let allowRules = schedule.allowRules ?? []

  if (body?.remove) {
    allowRules = removeRule(allowRules, body.remove)
  }

  if (body?.add?.length) {
    // Reject anything that isn't a well-formed rule rather than writing junk
    // into settings the CLI will later have to parse.
    const valid = body.add.filter(rule => parseRule(rule) !== null)
    if (!valid.length) {
      throw createError({ statusCode: 400, message: 'No valid permission rules were given.' })
    }
    allowRules = mergeRules(allowRules, valid)
  }

  const saved = await upsertSchedule({ ...schedule, allowRules })
  return { ...saved, description: describeRecurrence(saved.recurrence) }
})
