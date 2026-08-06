import { runClaude } from './cli'

/**
 * The MCP servers this machine has, and whether they work.
 *
 * Everything else here reads `.claude` off disk. This one cannot: the config
 * files hold almost none of it. A machine with eight servers had exactly one
 * in `~/.claude.json` — the rest arrive from claude.ai connectors and from
 * installed plugins, which are assembled at run time and written down nowhere
 * a file reader could find them.
 *
 * So Claude Code itself is the source of truth, via `claude mcp list`. It also
 * health-checks each server, which is the part worth having: a server that is
 * configured and a server that works are different things, and until now this
 * app could not tell you which you had.
 *
 * The cost is parsing output meant for a person. That is why the parser is a
 * pure function with its own tests — the shape of these lines is not ours, and
 * the day it changes we would rather have a failing test than a blank page.
 */

export type McpStatus =
  /** Health-checked and answering. */
  | 'connected'
  /** Reachable, but it wants an OAuth login before it will do anything. */
  | 'needs-auth'
  /** Configured and broken. `detail` says how. */
  | 'failed'
  /** A `.mcp.json` server nobody has approved for this project yet. */
  | 'pending'
  /** Claude Code said something this does not recognise. `detail` has it raw. */
  | 'unknown'

export interface McpServer {
  name: string
  /** The URL, or the command for a stdio server. */
  target: string
  /** `HTTP`, `SSE` — absent for stdio, which is the unlabelled case. */
  transport?: string
  status: McpStatus
  /** Why it is not working, when it isn't. Can be long and can contain HTML. */
  detail?: string
  /**
   * Where it came from, as far as the name gives it away. Claude Code prefixes
   * plugin servers and its own connectors, which is the only provenance on
   * offer without a `claude mcp get` per server — eight more health checks for
   * information most people never look at.
   */
  origin: 'plugin' | 'claude.ai' | 'project'
  /** For a plugin server, which plugin. */
  pluginName?: string
}

/** The markers Claude Code puts in front of a status. */
const STATUS_BY_MARKER: Record<string, McpStatus> = {
  '✔': 'connected',
  '!': 'needs-auth',
  '✘': 'failed',
  '⏸': 'pending',
}

/**
 * One line of `claude mcp list`, or null when it isn't a server line.
 *
 * The shape is `name: target - <marker> status`, and every part of it can
 * contain the delimiters of the others: names hold colons (`plugin:slack:slack`),
 * and a failure detail holds most of an HTML page including dashes. What is
 * reliable is the marker, so the split is anchored on that and everything left
 * of it is taken greedily.
 */
export function parseMcpLine(line: string): McpServer | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const markers = Object.keys(STATUS_BY_MARKER).join('')
  const match = trimmed.match(new RegExp(`^(.+?):\\s(.*)\\s-\\s([${markers}])\\s*(.*)$`, 'u'))
  if (!match) return null

  const [, name, rawTarget, marker, rest] = match
  if (!name || rawTarget === undefined) return null

  // A trailing `(HTTP)` is the transport; stdio servers carry no label.
  const withTransport = rawTarget.match(/^(.*?)\s*\(([A-Za-z]+)\)$/)
  const target = (withTransport?.[1] ?? rawTarget).trim()
  const transport = withTransport?.[2]

  const detail = (rest ?? '').trim()

  return {
    name,
    target,
    ...(transport ? { transport } : {}),
    status: STATUS_BY_MARKER[marker!] ?? 'unknown',
    // The status word itself ("Connected") adds nothing next to the icon; a
    // failure's explanation is the whole point of showing anything.
    ...(detail && marker !== '✔' ? { detail } : {}),
    ...originOf(name),
  }
}

/** What the name gives away about where a server came from. */
function originOf(name: string): { origin: McpServer['origin']; pluginName?: string } {
  const plugin = name.match(/^plugin:([^:]+):/)
  if (plugin) return { origin: 'plugin', pluginName: plugin[1] }
  if (name.startsWith('claude.ai ')) return { origin: 'claude.ai' }
  return { origin: 'project' }
}

/** Everything `claude mcp list` printed, minus the noise. */
export function parseMcpList(stdout: string): McpServer[] {
  return stdout
    .split('\n')
    .map(parseMcpLine)
    .filter((server): server is McpServer => server !== null)
}

/**
 * Health-checking every server takes seconds, and the page that shows them is
 * one people leave open. Cached per directory, briefly — long enough that
 * moving around the app is free, short enough that fixing an auth problem and
 * coming back tells you the truth.
 */
const CACHE_MS = 30_000
const cache = new Map<string, { at: number; servers: McpServer[] }>()

export function forgetMcpCache(): void {
  cache.clear()
}

/**
 * The MCP servers visible from a directory.
 *
 * Directory matters: project-scoped servers come from a `.mcp.json` beside the
 * code, so the answer for one repository is not the answer for another.
 */
export async function listMcpServers(
  cwd: string | undefined,
  opts: { refresh?: boolean } = {},
): Promise<McpServer[]> {
  const key = cwd ?? '~'
  const hit = cache.get(key)
  if (!opts.refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.servers

  // Generous: this spawns a process that opens a connection to every server,
  // and one slow endpoint should not lose the other seven.
  const { stdout } = await runClaude(['mcp', 'list'], { cwd, timeout: 60_000 })

  const servers = parseMcpList(stdout)
  cache.set(key, { at: Date.now(), servers })
  return servers
}
