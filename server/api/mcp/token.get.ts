import { isLoopbackAddress, mcpTokenPath, readMcpToken } from '../../utils/mcpAccess'
import { SERVER_NAME } from '../../utils/mcpServer'

/**
 * The token for the tool server, and the config that uses it.
 *
 * This exists because the token is created lazily and that is a circle: the file
 * does not appear until something asks for it, and nothing can ask for it
 * without already knowing what is in it. Somebody setting this up needs one
 * command that both creates the token and tells them where it went.
 *
 * Loopback only, and no token of its own — requiring one would close the circle
 * again. That is not a hole: anything that can reach this can already read
 * `~/.claude/agents-ui/mcp-token` off disk, because it is running as you. What it
 * cannot be is a *web page*, which is the attacker this app defends against: a
 * page can send a cross-origin GET but cannot read the reply, and the loopback
 * check means a page on another device cannot send one at all.
 */
export default defineEventHandler(async (event) => {
  const address = event.node.req.socket.remoteAddress ?? undefined

  if (!isLoopbackAddress(address)) {
    throw createError({
      statusCode: 403,
      data: {
        error: 'not_loopback',
        message: 'The tool server\'s token is only handed out on the loopback interface. '
          + `Read it off disk instead: ${mcpTokenPath()}`,
      },
    })
  }

  const token = await readMcpToken()
  const url = `http://127.0.0.1:${process.env.PORT || 3000}/api/mcp/rpc`

  return {
    token,
    path: mcpTokenPath(),
    url,
    /** Ready to paste into a `.mcp.json`, which is the only thing anyone wants it for. */
    mcpJson: {
      mcpServers: {
        [SERVER_NAME]: {
          type: 'http',
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
  }
})
