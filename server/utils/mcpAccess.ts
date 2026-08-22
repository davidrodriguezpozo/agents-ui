import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getClaudeDir, OUR_DIR } from './claudeDir'

/**
 * How a local MCP client proves it is allowed to drive this app.
 *
 * The obvious thing to write here is a note about `middleware/sameOrigin.ts`
 * refusing anything that did not come from this app. It does not refuse an MCP
 * client, and finding that out is what this file is for. An MCP client over HTTP
 * sends no `Origin` and no `Sec-Fetch-Site` — a web page cannot omit either —
 * and its `Host` is `127.0.0.1:3000`, which is a literal address the host check
 * trusts. So `checkOrigin` waves it straight through, exactly as it waves
 * through `curl`: the middleware's boundary is "another program already running
 * as you", and it says so out loud.
 *
 * That boundary is the right one for the rest of the app and the wrong one here,
 * which is the whole reason this exists. Everywhere else, reaching the API means
 * having already got a browser to this machine's port. This endpoint is the
 * app's write surface compressed into one line of JSON that anything able to
 * open a socket can post — a package's postinstall script, a browser
 * extension's native host, a container that publishes 3000 back at the host —
 * and `start_session` spends money running Claude Code against your
 * repositories. A drive-by POST should not be able to do that.
 *
 * So this one endpoint asks for two things the rest of the app does not:
 *
 *   - **A token read off disk.** `~/.claude/agents-ui/mcp-token`, mode 0600,
 *     created the first time anything asks for it. Presenting it means already
 *     being able to read that directory — which holds your sessions and sits
 *     beside your Claude credentials — so it grants nothing that was not
 *     already reachable, and it is a wall a blind POST cannot climb. Widening
 *     the origin rule was the alternative and would have been much worse: that
 *     rule defends every other endpoint, and the fix for one route is not to
 *     lower the floor under all of them.
 *   - **A loopback peer address.** Read off the socket rather than out of a
 *     header, because every header is the caller's claim — `Host` and
 *     `X-Forwarded-For` included — and the peer address is the kernel's. This
 *     is the one place in the app that refuses a request from the phone on your
 *     LAN even when `HOST=0.0.0.0` invited it: a tool that starts sessions is
 *     not something to expose on a shared network by accident.
 */

/** Where the token lives. Beside the sessions it can start, deliberately. */
export function mcpTokenPath(): string {
  return join(getClaudeDir(), OUR_DIR, 'mcp-token')
}

/** 32 bytes of hex: long enough that guessing is not a strategy. */
function newToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * The token for this machine, created if it has never been asked for.
 *
 * Created lazily rather than at boot because most installs never configure this
 * server, and a secret nobody wants is one more file to explain. Cached in
 * memory: it is read on every MCP request and it cannot change under us without
 * a restart, since nothing here rewrites it.
 */
let cached: { path: string; token: string } | null = null

export async function readMcpToken(): Promise<string> {
  const path = mcpTokenPath()
  if (cached?.path === path) return cached.token

  if (existsSync(path)) {
    const existing = (await readFile(path, 'utf-8')).trim()
    if (existing) {
      cached = { path, token: existing }
      return existing
    }
    // An empty file is a half-finished write, not a token. Fall through and
    // replace it rather than accepting '' as a password every caller matches.
  }

  const token = newToken()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${token}\n`, { encoding: 'utf-8', mode: 0o600 })
  // Written again explicitly: `mode` on writeFile is masked by umask, and on a
  // machine with a permissive umask this file would otherwise be world-readable.
  await chmod(path, 0o600).catch(() => {})

  cached = { path, token }
  return token
}

/** Only for tests, which change `CLAUDE_DIR` between cases. */
export function forgetMcpToken(): void {
  cached = null
}

/**
 * Whether a peer address is this machine talking to itself.
 *
 * The whole of 127.0.0.0/8 rather than just 127.0.0.1, because that is what the
 * kernel treats as loopback and a client bound to 127.0.0.2 is no less local.
 * `::ffff:127.0.0.1` is what a v4 client looks like to a socket listening on
 * v6, which is the normal case on a dual-stack machine and not an edge one.
 *
 * An address we could not read is refused. It is not evidence of loopback, and
 * the failure to prefer is the one where nothing gets in.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  const raw = (address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!raw) return false

  const bare = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw

  if (bare === '::1' || bare === '0:0:0:0:0:0:0:1') return true

  const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!v4) return false

  return v4.slice(1).every(part => Number(part) <= 255) && Number(v4[1]) === 127
}

/** The token out of `Authorization: Bearer …`, or null. */
export function bearerToken(header: string | undefined | null): string | null {
  const match = (header ?? '').trim().match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

/**
 * Constant-time comparison, with the length difference handled first.
 *
 * `timingSafeEqual` throws on buffers of different lengths, so the lengths have
 * to be compared in the open. That leaks the length of the token, which is a
 * fixed 64 characters and therefore not a secret.
 */
export function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface McpRequestFacts {
  /** The socket's peer address. Not a header — see the note at the top. */
  address?: string
  authorization?: string
  /** For a client that cannot set `Authorization`. Same token, same weight. */
  token?: string
}

export type McpAccessVerdict =
  | { allowed: true }
  | { allowed: false; status: number; error: string; message: string }

/**
 * Whether an MCP request may proceed. Pure, so the two refusals can be tested
 * without a socket.
 *
 * Loopback is checked before the token, because "you are not on this machine"
 * is true regardless of what you presented and is the more useful thing to be
 * told.
 */
export function checkMcpAccess(request: McpRequestFacts, expected: string): McpAccessVerdict {
  if (!isLoopbackAddress(request.address)) {
    return {
      allowed: false,
      status: 403,
      error: 'not_loopback',
      message: `This tool server answers on the loopback interface only, and this request came from `
        + `${request.address || 'an address it could not read'}. Run the MCP client on the same `
        + 'machine as Agents Studio.',
    }
  }

  const presented = bearerToken(request.authorization) ?? (request.token ?? '').trim()

  if (!presented) {
    return {
      allowed: false,
      status: 401,
      error: 'no_token',
      message: 'This tool server needs the token in '
        + `${mcpTokenPath()} — send it as "Authorization: Bearer <token>".`,
    }
  }

  if (!tokensMatch(presented, expected)) {
    return {
      allowed: false,
      status: 401,
      error: 'bad_token',
      message: `That is not this machine's token. The current one is in ${mcpTokenPath()}; `
        + 'it changes only if that file is deleted.',
    }
  }

  return { allowed: true }
}
