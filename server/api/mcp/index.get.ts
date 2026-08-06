import { listMcpServers } from '../../utils/mcp'
import { readProjectState } from '../../utils/projects'

/**
 * The MCP servers visible from the project you are in, and whether they work.
 *
 * Health-checking every server takes seconds, so the result is cached briefly
 * and `?refresh=1` is how you say you have just fixed something and want to
 * know. Slow on a cold call by nature — it opens a connection to each one.
 */
export default defineEventHandler(async (event) => {
  const refresh = getQuery(event).refresh === '1'
  // The active project, because a `.mcp.json` beside the code is one of the
  // places these come from — so the answer depends on where you ask.
  const cwd = (await readProjectState()).activePath ?? undefined

  try {
    return { cwd: cwd ?? null, servers: await listMcpServers(cwd, { refresh }) }
  } catch (e: any) {
    // The CLI missing is a real answer, not a server error: this app runs
    // through Claude Code, and saying so beats an empty list that reads as
    // "you have no MCP servers".
    const code = e?.data?.error
    if (code === 'cli_not_found' || code === 'timeout') throw e

    throw createError({
      statusCode: 502,
      data: {
        error: 'mcp_unavailable',
        message: e?.data?.message || 'Could not ask Claude Code which MCP servers you have.',
      },
    })
  }
})
