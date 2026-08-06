import { loginToMcpServer } from '../../../utils/mcp'
import { readProjectState } from '../../../utils/projects'

/**
 * Sign in to an MCP server that is asking for it.
 *
 * `claude mcp login` opens the browser and waits on a local callback, so this
 * request stays open for as long as the person is in the browser — up to five
 * minutes, after which the CLI is killed rather than left holding a port.
 *
 * Worth the odd shape: five of the nine servers on a real machine were sitting
 * in "needs authentication", and the fix was a command nobody knew to run.
 */
export default defineEventHandler(async (event) => {
  const name = decodeURIComponent(getRouterParam(event, 'name')!)
  if (!name) throw createError({ statusCode: 400, message: 'name is required' })

  try {
    await loginToMcpServer(name, (await readProjectState()).activePath ?? undefined)
    return { ok: true }
  } catch (e: any) {
    if (e?.data?.error === 'timeout') {
      throw createError({
        statusCode: 504,
        data: {
          error: 'login_timeout',
          message: 'The sign-in was not finished in time. Try again — the browser window is where it happens.',
        },
      })
    }
    throw e
  }
})
