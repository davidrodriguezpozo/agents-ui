import { loginToMcpServer } from '../../../utils/mcp'
import { readProjectState } from '../../../utils/projects'

/**
 * Sign in to an MCP server that is asking for it.
 *
 * The request stays open for as long as the person is in the browser — up to
 * five minutes, after which the CLI is killed rather than left holding the
 * OAuth callback port.
 *
 * Worth the odd shape: five of the nine servers on a real machine were sitting
 * in "needs authentication", and the fix was a command nobody knew to run.
 * `loginToMcpServer` already shapes every failure into something worth reading,
 * so there is nothing to translate here.
 */
export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name')!)
  if (!name) throw createError({ statusCode: 400, message: 'name is required' })

  await loginToMcpServer(name, (await readProjectState()).activePath ?? undefined)
  return { ok: true }
})
