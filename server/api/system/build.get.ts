import { buildStatus, describeBuild } from '../../utils/buildInfo'

export default defineEventHandler(async () => {
  const status = await buildStatus()
  return { ...status, summary: describeBuild(status) }
})
