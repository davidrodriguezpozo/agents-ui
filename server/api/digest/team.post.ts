import { sendTeamDigest, teamDeliveryStore } from '../../utils/teamDelivery'
import { getProjectDir } from '../../utils/scope'

/**
 * Send the team digest now, or change its settings.
 *
 * One endpoint for both because they are one flow: the first send is what proves
 * the destination, and the schedule cannot be armed until that has happened. A
 * separate settings endpoint would let somebody turn the schedule on for a
 * destination nothing has ever reached.
 */
export default defineEventHandler(async (event) => {
  interface Body {
    send?: boolean
    enabled?: boolean
    at?: string | null
    destination?: string
    dir?: string
  }

  const body = await readBody<Body>(event).catch((): Body => ({}))

  const projectDir = body?.dir || getProjectDir(event) || undefined

  if (body?.send) {
    const outcome = await sendTeamDigest({
      projectDir,
      destination: body.destination,
      // A press gets a message even on a quiet day: an empty answer to a button
      // reads as broken software. The schedule never forces.
      force: true,
    })

    if (!outcome.ok && outcome.refusal) {
      throw createError({ statusCode: 400, data: outcome.refusal })
    }

    return outcome
  }

  const next = await teamDeliveryStore.update((current) => {
    if (typeof body?.destination === 'string') current.destination = body.destination.trim()
    if (body?.at !== undefined) current.at = body.at?.trim() || undefined
    if (typeof body?.enabled === 'boolean') current.enabled = body.enabled
    if (projectDir) current.projectDir = projectDir

    return { ...current }
  })

  return { state: next }
})
