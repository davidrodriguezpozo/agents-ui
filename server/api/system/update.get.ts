import { buildStatus, describeBuild } from '../../utils/buildInfo'
import { updatePlan } from '../../utils/updates'

/**
 * What is running, and whether there is anything newer.
 *
 * One endpoint rather than two, because the answer to "which version is this"
 * and "should I update" come from the same place and are read together.
 */
export default defineEventHandler(async () => {
  const status = await buildStatus()
  return {
    build: { ...status, summary: describeBuild(status) },
    update: await updatePlan(status),
  }
})
