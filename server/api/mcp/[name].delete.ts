import { removeMcpServer } from '../../utils/mcp'
import { readProjectState } from '../../utils/projects'

/**
 * Remove an MCP server.
 *
 * No scope is passed: Claude Code removes it from whichever scope it is in,
 * which is what someone pressing this means. Asking them which of three files
 * it lives in would be asking them to know something the app is for knowing.
 */
export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name')!)
  if (!name) throw createError({ statusCode: 400, message: 'name is required' })

  await removeMcpServer(name, (await readProjectState()).activePath ?? undefined)
  return { ok: true }
})
