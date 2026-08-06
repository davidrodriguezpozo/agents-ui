import {
  addMcpServer, invalidName, MCP_SCOPES, MCP_TRANSPORTS,
  type AddMcpInput, type McpScope, type McpTransport,
} from '../../utils/mcp'
import { readProjectState } from '../../utils/projects'

/**
 * Add an MCP server.
 *
 * Handed to `claude mcp add` rather than written to a file, because Claude Code
 * owns where these live and there are three possible files depending on scope.
 * Everything goes across as separate argv entries, never through a shell.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<AddMcpInput>>(event)

  const nameProblem = invalidName(body?.name ?? '')
  if (nameProblem) {
    throw createError({ statusCode: 400, data: { error: 'bad_name', message: nameProblem } })
  }

  const transport = body?.transport as McpTransport
  if (!MCP_TRANSPORTS.includes(transport)) {
    throw createError({ statusCode: 400, data: { error: 'bad_transport', message: 'Pick a transport.' } })
  }

  const scope = body?.scope as McpScope
  if (!MCP_SCOPES.includes(scope)) {
    throw createError({ statusCode: 400, data: { error: 'bad_scope', message: 'Pick where to save it.' } })
  }

  const target = body?.target?.trim()
  if (!target) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'no_target',
        message: transport === 'stdio' ? 'Give the command to run.' : 'Give the server URL.',
      },
    })
  }

  if (transport !== 'stdio' && !/^https?:\/\//i.test(target)) {
    throw createError({
      statusCode: 400,
      data: { error: 'bad_url', message: 'An http or sse server needs a URL starting with http:// or https://.' },
    })
  }

  await addMcpServer(
    {
      name: body!.name!.trim(),
      transport,
      scope,
      target,
      args: (body?.args ?? []).map(a => String(a)).filter(Boolean),
      env: body?.env ?? {},
      headers: body?.headers ?? {},
    },
    (await readProjectState()).activePath ?? undefined,
  )

  return { ok: true }
})
