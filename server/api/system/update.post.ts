import { buildStatus } from '../../utils/buildInfo'
import { runUpdate, updatePlan } from '../../utils/updates'

/**
 * Install the newest release over this one.
 *
 * Refused unless the running instance is one this can actually update — a
 * checkout is updated with `git pull`, which is the person's business and not
 * a button's. Checked here rather than trusted to the UI having hidden it.
 *
 * State-changing, so the same-origin check in front of every request applies.
 */
export default defineEventHandler(async () => {
  const plan = await updatePlan(await buildStatus())

  if (!plan.canRun) {
    throw createError({
      statusCode: 400,
      message: plan.note ?? 'There is nothing to update from here.',
    })
  }

  return runUpdate()
})
