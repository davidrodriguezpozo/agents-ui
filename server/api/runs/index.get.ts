import { listRuns } from '../../utils/runStore'

export default defineEventHandler(async (event) => {
  const limit = Number(getQuery(event).limit) || 50
  return listRuns(limit)
})
