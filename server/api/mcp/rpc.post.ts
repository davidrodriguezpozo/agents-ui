import { checkMcpAccess, readMcpToken } from '../../utils/mcpAccess'
import { handleRpc } from '../../utils/mcpServer'

/**
 * The MCP endpoint: this app as a tool server, over one POST.
 *
 * Everything else under `/api/mcp/` is about the MCP servers *this machine*
 * has. This is the other direction, and it is the only route in the app with a
 * check in front of it that the middleware does not already do — see
 * `utils/mcpAccess.ts` for why an MCP client sails through `sameOrigin` and why
 * that is not good enough here.
 *
 * A malformed body comes back as a JSON-RPC parse error rather than as h3's 400,
 * because a client that sent bad JSON is a client that can read a JSON-RPC
 * envelope and cannot be relied on to read anything else.
 */
export default defineEventHandler(async (event) => {
  const verdict = checkMcpAccess(
    {
      /*
       * The socket, not `getRequestIP`. That helper will read
       * `X-Forwarded-For` if asked, and every header is the caller's claim —
       * which is exactly the thing this check must not accept.
       */
      address: event.node.req.socket.remoteAddress ?? undefined,
      authorization: getHeader(event, 'authorization'),
      token: getHeader(event, 'x-agents-studio-token'),
    },
    await readMcpToken(),
  )

  if (!verdict.allowed) {
    throw createError({
      statusCode: verdict.status,
      data: { error: verdict.error, message: verdict.message },
    })
  }

  const raw = await readRawBody(event, 'utf-8')

  let message: unknown
  try {
    message = JSON.parse(raw || '')
  } catch {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'That request body is not JSON.' },
    }
  }

  const response = await handleRpc(message)

  // A notification has no reply. 202 with nothing in it is what the spec asks
  // for, and returning an empty JSON-RPC object instead would be an error.
  if (!response) {
    setResponseStatus(event, 202)
    return null
  }

  return response
})
