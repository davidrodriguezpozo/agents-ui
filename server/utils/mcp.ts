import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findClaude, runClaude } from './cli'

const exec = promisify(execFile)

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

// --- Changing them -----------------------------------------------------------

/**
 * Where a server is written down.
 *
 * `local` is this machine only, `user` follows you between projects, `project`
 * goes in a `.mcp.json` beside the code and therefore into the commit — which
 * is the one worth thinking about before choosing, since it decides for
 * everyone who clones the repository.
 */
export const MCP_SCOPES = ['local', 'user', 'project'] as const
export type McpScope = (typeof MCP_SCOPES)[number]

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

export interface AddMcpInput {
  name: string
  transport: McpTransport
  scope: McpScope
  /** The URL for http/sse, or the executable for stdio. */
  target: string
  /** stdio only — one argument per entry, so a path with a space survives. */
  args?: string[]
  /** stdio only. Values are secrets: they go to the CLI and are never read back. */
  env?: Record<string, string>
  /** http/sse only, e.g. `Authorization: Bearer …`. Secrets, as above. */
  headers?: Record<string, string>
}

/**
 * A name Claude Code will accept and we can hand back on a URL.
 *
 * Deliberately narrow. Everything here is passed as an argv entry rather than
 * through a shell, so this is not what stands between you and an injection —
 * it is what stops a name that cannot later be removed, because nothing could
 * address it.
 */
export function invalidName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Give the server a name.'
  if (trimmed.length > 64) return 'That name is too long.'
  if (!/^[\w.-]+$/.test(trimmed)) {
    return 'Use letters, numbers, dots, dashes and underscores — no spaces.'
  }
  return null
}

/** The argv for `claude mcp add`, which is the whole of this function's job. */
export function addArgs(input: AddMcpInput): string[] {
  const args = ['mcp', 'add', '--scope', input.scope]

  if (input.transport !== 'stdio') args.push('--transport', input.transport)

  for (const [key, value] of Object.entries(input.env ?? {})) {
    args.push('--env', `${key}=${value}`)
  }
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    args.push('--header', `${key}: ${value}`)
  }

  args.push(input.name.trim())

  if (input.transport === 'stdio') {
    // `--` so that a flag belonging to the server's own command is not read as
    // one of Claude Code's. Without it `add x -- server --verbose` loses.
    args.push('--', input.target.trim(), ...(input.args ?? []))
  } else {
    args.push(input.target.trim())
  }

  return args
}

export async function addMcpServer(input: AddMcpInput, cwd?: string): Promise<void> {
  // A project-scoped server is written beside the code, so it has to be written
  // in the right place — there is no sensible default when we don't know where.
  if (input.scope === 'project' && !cwd) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'no_project',
        message: 'Pick a project first — a project-scoped server is written into that repository.',
      },
    })
  }

  await runClaude(addArgs(input), { cwd, timeout: 30_000 })
  forgetMcpCache()
}

export async function removeMcpServer(name: string, cwd?: string): Promise<void> {
  await runClaude(['mcp', 'remove', name], { cwd, timeout: 30_000 })
  forgetMcpCache()
}

/** Shell-quote one argument, for the platform whose `script` wants a string. */
function quote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Ways to get a pseudo-terminal without adding a dependency.
 *
 * `claude mcp login` refuses to run when stdin is not a TTY — it prints the
 * authorization URL, says it is waiting, and then gives up on the spot. That
 * rules out driving it headlessly, and `--no-browser` too: there is no prompt
 * to answer, because it never reaches one. So it has to be given a terminal.
 *
 * Two ways, and the order matters:
 *
 *   - **python** is first because it is the one that works from a server.
 *     `pty.spawn` allocates the terminal for the child and wraps the read of
 *     *our* stdin in a try/except, so a piped stdin is fine.
 *   - **script** is the obvious tool for this and the wrong one here. BSD
 *     `script` calls `tcgetattr` on its own stdin before it does anything, and
 *     a process spawned by Node is handed a pipe — so it dies with
 *     "tcgetattr/ioctl: Operation not supported on socket" before the login
 *     starts. It is kept only for a machine with no usable python, where it
 *     will work if this app was started from a terminal.
 */
export type PtyRunner = 'python' | 'script'

/**
 * Passed as separate argv entries, so nothing here needs quoting and a server
 * name is never parsed as anything but a name.
 */
const PY_SPAWN = [
  'import pty, sys, os',
  'status = pty.spawn(sys.argv[1:])',
  'sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, "waitstatus_to_exitcode") else status >> 8)',
].join('\n')

export function ptyCommand(
  runner: PtyRunner,
  command: string,
  args: string[],
): { file: string; args: string[] } {
  if (runner === 'python') {
    return { file: 'python3', args: ['-c', PY_SPAWN, command, ...args] }
  }

  // BSD: the command follows the typescript file. GNU wants one string, which
  // is the only place quoting is needed — real names are `plugin:slack:slack`
  // and `claude.ai Google Drive`.
  return process.platform === 'darwin'
    ? { file: 'script', args: ['-q', '/dev/null', command, ...args] }
    : { file: 'script', args: ['-q', '-c', [command, ...args].map(quote).join(' '), '/dev/null'] }
}

let ptyRunner: PtyRunner | null | undefined

/** Which of them this machine actually has. Memoised — it cannot change. */
export async function detectPtyRunner(): Promise<PtyRunner | null> {
  if (ptyRunner !== undefined) return ptyRunner

  try {
    await exec('python3', ['-c', 'import pty'], { timeout: 5_000 })
    ptyRunner = 'python'
    return ptyRunner
  } catch {
    // Fall through.
  }

  if (process.platform !== 'win32') {
    try {
      await exec('sh', ['-c', 'command -v script'], { timeout: 5_000 })
      ptyRunner = 'script'
      return ptyRunner
    } catch {
      // Fall through.
    }
  }

  ptyRunner = null
  return ptyRunner
}

/**
 * Sign in to a server that is asking for it.
 *
 * Waits for the browser flow to finish, which is minutes if the person is slow
 * and forever if they wander off — hence the ceiling, which is what makes this
 * safe to offer at all. An abandoned login would otherwise leave a process
 * holding the OAuth callback port until the server restarted.
 */
export async function loginToMcpServer(name: string, cwd?: string): Promise<void> {
  const claude = await findClaude()
  if (!claude) {
    throw createError({
      statusCode: 500,
      data: { error: 'cli_not_found', message: 'Claude Code CLI not found.' },
    })
  }

  const runner = await detectPtyRunner()
  if (!runner) {
    throw createError({
      statusCode: 501,
      data: {
        error: 'needs_terminal',
        message: `Signing in needs a terminal, and this machine has no way to make one. Run it yourself: claude mcp login "${name}"`,
      },
    })
  }

  const wrapped = ptyCommand(runner, claude, ['mcp', 'login', name])

  try {
    await exec(wrapped.file, wrapped.args, { cwd, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 })
  } catch (e: any) {
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`

    if (e.killed) {
      throw createError({
        statusCode: 504,
        data: {
          error: 'login_timeout',
          message: 'The sign-in was not finished in time. Try again — the browser window is where it happens.',
        },
      })
    }

    // `script` reports the child's exit code as its own, so a refusal from
    // Claude Code arrives here rather than as anything of `script`'s.
    const said = output.split('\n').map(l => l.trim()).filter(Boolean).at(-1)
    throw createError({
      statusCode: 502,
      data: { error: 'login_failed', message: said || 'The sign-in did not complete.' },
    })
  }

  forgetMcpCache()
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
