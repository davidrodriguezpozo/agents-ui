import { getProjectDir } from '../../utils/scope'
import { rulesForProject } from '../../utils/projectRules'

export default defineEventHandler(async (event) => {
  const dir = (getQuery(event).dir as string) || getProjectDir(event)
  return { dir: dir ?? null, rules: await rulesForProject(dir ?? undefined) }
})
