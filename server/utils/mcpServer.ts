import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { collectAttention } from './attention'
import { briefIsEmpty, readBrief, renderBrief } from './brief'
import { checkBudget, startOfToday } from './budget'
import { readPreferences } from './preferences'
import { runsSince } from './runStore'
import { readSessions, titleFromPrompt } from './sessions'
import { startSession } from './startSession'
import { startTurn } from './sessionTurn'
import { localDay, summarizeSpend, type SideCost } from './spend'

/**
 * This app as a tool an agent can use, rather than a place agents are configured.
 *
 * `utils/mcp.ts` is the other direction: which MCP servers this machine has and
 * whether they work. Nothing here reads that file. What was missing was the
 * inverse — a session that can ask this app what is going on and act on the
 * answer, instead of a person reading a sidebar and retyping it into a prompt.
 *
 * The whole point is that the answers are the app's own. `blocked` calls the
 * same `collectAttention` the sidebar polls; `brief` renders the same text a run
 * is actually handed. A tool server with its own idea of what is blocked would
 * be worse than none: a run told nothing is waiting stops looking, and it would
 * have been told that by the app that knew otherwise.
 *
 * **Four reads and one write, and the asymmetry is deliberate.** Reading is
 * free, reversible and the thing a session needs before it can be useful.
 * Writing is `start_session`, which spends money running Claude Code against
 * your repositories — so there is exactly one of them, and it goes through
 * `startSession` and `startTurn`, which is the same path the composer takes. No
 * second way to make a session, because the second one is the one that skips a
 * check.
 *
 * **No SDK.** `package.json` has no runtime dependencies by design, and the MCP
 * wire protocol here is JSON-RPC 2.0 over one POST: three methods that matter,
 * a fixed tool list, and no session state. That is small enough to own, and the
 * shapes are pinned by tests so that the day a client sends something else we
 * get a failure rather than a blank tool list.
 */

// --- Protocol ---------------------------------------------------------------

/**
 * What this server's own contract is on, not what release of the app it is.
 *
 * Deliberately not the app version: knowing the app is 0.19.1 tells a client
 * nothing about whether `sessions` still has the field it wants, and finding the
 * app version out costs a `git` spawn on a handshake.
 */
export const SERVER_VERSION = '1'
export const SERVER_NAME = 'agents-studio'

/** What we answer with when the client asks for something we do not know. */
export const PROTOCOL_VERSION = '2025-06-18'

/**
 * Versions whose handshake we can honestly echo back. A client asking for one of
 * these is told it got what it asked for; anything else — an older client, or one
 * from next year — is told what we do speak, which is what the spec asks for.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', PROTOCOL_VERSION]

export interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: string | number | null
  method?: unknown
  params?: unknown
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

/** The subset of JSON-RPC's codes this can actually produce. */
export const RPC_INVALID_REQUEST = -32600
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  /**
   * A tool that could not do its job, reported to the model rather than to the
   * transport. This is the difference between "your repo path is wrong, here is
   * what to send instead" — which a session can act on — and a 500, which ends
   * the turn.
   */
  isError?: boolean
}

export interface McpToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  run(args: Record<string, unknown>): Promise<McpToolResult>
}

function text(body: string): McpToolResult {
  return { content: [{ type: 'text', text: body }] }
}

/** Structured answers go out as JSON, so a script can pipe what a model reads. */
function json(data: unknown): McpToolResult {
  return text(JSON.stringify(data, null, 2))
}

function failure(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

// --- The tools --------------------------------------------------------------

/** Enough sessions to see the shape of the machine without a wall of JSON. */
export const MAX_MCP_SESSIONS = 50

/** Money, at a precision where floating point noise cannot show through. */
function money(usd: number): number {
  return Math.round(usd * 10_000) / 10_000
}

/**
 * A repository path as an agent is likely to give it: `~` expanded, relative
 * refused rather than resolved against whatever directory this server happens to
 * be running in — which for a background service is nobody's idea of anywhere.
 */
export function resolveRepoPath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const expanded = trimmed === '~'
    ? homedir()
    : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed

  if (!isAbsolute(expanded)) return null

  const dir = resolve(expanded)
  return existsSync(dir) ? dir : null
}

const BRIEF_TOOL: McpToolDefinition = {
  name: 'brief',
  title: 'The standing brief',
  description:
    'The exact text a run on this machine is handed before it starts: work in flight and what '
    + 'each session did, what landed in the last two days, scheduled work that has stopped '
    + 'working, how much is waiting elsewhere, and the standing facts the user pinned. Assembled '
    + 'from files this machine keeps, not written by a model, so it cannot invent a branch. It is '
    + 'context rather than instructions.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Absolute path to a repository, to put its own sessions first. Optional.',
      },
    },
    additionalProperties: false,
  },
  async run(args) {
    const brief = await readBrief()

    // Said rather than returned empty. "Nothing" and "turned off" are different
    // facts about what runs are told, and a caller that cannot tell them apart
    // would report the wrong one.
    if (!brief.enabled) {
      return text('The standing brief is turned off in Settings, so runs on this machine are handed none of it.')
    }
    if (briefIsEmpty(brief)) {
      return text('The standing brief is empty — nothing is in flight, nothing is waiting, and nothing '
        + 'has been pinned — so runs are handed none of it.')
    }

    const repo = typeof args.repo === 'string' ? resolveRepoPath(args.repo) : null
    return text(renderBrief(brief, { projectDir: repo ?? undefined }))
  },
}

const BLOCKED_TOOL: McpToolDefinition = {
  name: 'blocked',
  title: 'What needs a person',
  description:
    'Everything on this machine that will not move until a person does something: sessions '
    + 'stopped on a permission prompt, and scheduled work whose last runs came to nothing. The '
    + 'same answer the app\'s own sidebar shows.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run() {
    return json(await collectAttention())
  },
}

const SESSIONS_TOOL: McpToolDefinition = {
  name: 'sessions',
  title: 'Sessions on this machine',
  description:
    'Every session that is not closed, newest first: its id, repository, branch, how the '
    + 'project\'s own checks last went there, and one sentence on what it did. `repoDir` is the '
    + 'absolute path `start_session` wants.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run() {
    const all = (await readSessions())
      .filter(session => session.status !== 'archived')
      .sort((a, b) => b.updatedAt - a.updatedAt)

    return json({
      sessions: all.slice(0, MAX_MCP_SESSIONS).map(session => ({
        id: session.id,
        title: session.title,
        repo: basename(session.repoDir || ''),
        repoDir: session.repoDir,
        branch: session.branch,
        /**
         * Null is "never run here", which is not the same as passing and is
         * shown as the difference it is everywhere else in the app.
         */
        checks: session.check?.status ?? null,
        summary: session.summary?.text ?? null,
        running: session.status === 'running',
        landed: Boolean(session.landed),
        hasPr: Boolean(session.prUrl),
        updatedAt: session.updatedAt,
      })),
      // Said rather than silently dropped: a caller that thinks it has the whole
      // list will conclude a session it cannot see does not exist.
      more: Math.max(0, all.length - MAX_MCP_SESSIONS),
    })
  },
}

const SPEND_TODAY_TOOL: McpToolDefinition = {
  name: 'spend_today',
  title: 'What today has cost',
  description:
    'What has been spent since midnight local time, across sessions, scheduled work and the '
    + 'summaries that never enter the run log — with the daily limit, if one is set, and what is '
    + 'left of it.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run() {
    const now = Date.now()
    const since = startOfToday(now)

    const [runs, sessions] = await Promise.all([runsSince(since), readSessions()])

    // Session summaries are model calls that deliberately never enter the run
    // log. Leaving them out would make this quietly optimistic, which is the
    // one thing a spend figure must not be.
    const side: SideCost[] = sessions
      .map(session => session.summary)
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.costUsd > 0 && s.at >= since))
      .map(s => ({ source: 'summary' as const, costUsd: s.costUsd, at: s.at }))

    const summary = summarizeSpend(runs, 1, now, side)

    // Never blocks on a limit it could not read — the same rule `checkBudget`
    // follows, for the same reason.
    const dailyCapUsd = await readPreferences()
      .then(prefs => prefs.dailyCapUsd || null)
      .catch(() => null)

    return json({
      date: localDay(now),
      spentUsd: money(summary.total),
      runs: summary.runs,
      bySource: summary.bySource.map(entry => ({ source: entry.source, costUsd: money(entry.cost), runs: entry.runs })),
      dailyCapUsd,
      remainingUsd: dailyCapUsd === null ? null : money(Math.max(0, dailyCapUsd - summary.total)),
      overCap: dailyCapUsd === null ? false : summary.total >= dailyCapUsd,
    })
  },
}

const START_SESSION_TOOL: McpToolDefinition = {
  name: 'start_session',
  title: 'Start a session',
  description:
    'Cut a branch and an isolated worktree in a repository on this machine, and start Claude '
    + 'Code working on an instruction there. Nothing is committed to the base branch, nothing is '
    + 'pushed and no pull request is opened — the work waits in the session for a person. This '
    + 'is the only thing this server writes, and it spends money.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Absolute path to a git repository on this machine. `sessions` reports the '
          + 'paths it already knows as `repoDir`.',
      },
      instruction: {
        type: 'string',
        description: 'What the session should do, as you would type it. It also names the session.',
      },
    },
    required: ['repo', 'instruction'],
    additionalProperties: false,
  },
  async run(args) {
    const repo = typeof args.repo === 'string' ? args.repo : ''
    const instruction = (typeof args.instruction === 'string' ? args.instruction : '').trim()

    if (!repo.trim()) {
      return failure('Give `repo` — the absolute path of a git repository on this machine. '
        + 'The `sessions` tool reports the paths it already knows as `repoDir`.')
    }
    if (!instruction) {
      return failure('Give `instruction` — what the session should do. A session with nothing to '
        + 'do is a worktree nobody asked for.')
    }

    const repoDir = resolveRepoPath(repo)
    if (!repoDir) {
      return failure(`There is nothing at "${repo}". Give an absolute path to a repository on `
        + 'this machine; `~` is expanded but a relative path is not, because this server has no '
        + 'meaningful working directory.')
    }

    // Checked before the worktree is cut. A session that is over the limit
    // cannot do anything, and an empty workspace left behind to explain that is
    // clutter somebody then has to clean up.
    const budget = await checkBudget()
    if (!budget.allowed) return failure(budget.reason!)

    const session = await startSession({ repoDir, title: titleFromPrompt(instruction) })

    const started = {
      id: session.id,
      title: session.title,
      repo: basename(repoDir),
      repoDir,
      branch: session.branch,
      worktreePath: session.worktreePath,
      baseBranch: session.baseBranch,
    }

    // The worktree exists and is recorded by this point, so a turn that will not
    // start is still a session somebody has. Reported rather than rolled back:
    // destroying a real workspace to tidy up an error message loses more than it
    // saves, and the session is one message away from being fine.
    try {
      return json({ ...started, runId: await startTurn(session, instruction) })
    } catch (e: any) {
      return {
        ...json({
          ...started,
          startError: e?.data?.message ?? e?.message
            ?? 'The session was created but could not start working.',
        }),
        isError: true,
      }
    }
  },
}

export const TOOLS: McpToolDefinition[] = [
  BRIEF_TOOL,
  BLOCKED_TOOL,
  SESSIONS_TOOL,
  SPEND_TODAY_TOOL,
  START_SESSION_TOOL,
]

/** What `tools/list` returns: the definitions without the code behind them. */
export function toolListing() {
  return TOOLS.map(({ name, title, description, inputSchema }) => ({
    name, title, description, inputSchema,
  }))
}

/**
 * Run a tool, turning anything it throws into a result the model can read.
 *
 * A store that will not parse, a repository that is not a repository, a git
 * command that failed: all of those arrive here as thrown errors carrying a
 * sentence written for a person. Handing that sentence back as `isError` lets
 * the session say what went wrong and try something else; letting it out as a
 * transport error tells it only that the tool broke.
 */
export async function callTool(name: unknown, args: unknown): Promise<McpToolResult> {
  const tool = TOOLS.find(candidate => candidate.name === name)
  if (!tool) {
    return failure(`There is no tool called "${String(name)}" here. `
      + `This server has: ${TOOLS.map(t => t.name).join(', ')}.`)
  }

  const params = (args && typeof args === 'object' && !Array.isArray(args))
    ? args as Record<string, unknown>
    : {}

  try {
    return await tool.run(params)
  } catch (e: any) {
    return failure(e?.data?.message ?? e?.message ?? `${tool.name} failed and said nothing about why.`)
  }
}

// --- Dispatch ---------------------------------------------------------------

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/**
 * One JSON-RPC message in, one response out — or null for a notification, which
 * by the spec must not be answered at all.
 *
 * Stateless on purpose. There is no session id and no stream: a client can be
 * restarted, or two of them can run at once, and neither has anything here to
 * get out of step with.
 */
export async function handleRpc(message: unknown): Promise<JsonRpcResponse | null> {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, RPC_INVALID_REQUEST, 'Expected one JSON-RPC object. Batches are not accepted.')
  }

  const { id, method, params } = message as JsonRpcRequest
  const rpcId = typeof id === 'string' || typeof id === 'number' ? id : null

  // No id is a notification: `notifications/initialized` is the one that
  // actually arrives, and answering it would be a protocol error of our own.
  if (id === undefined || id === null) return null

  if (typeof method !== 'string' || !method) {
    return rpcError(rpcId, RPC_INVALID_REQUEST, 'That message has no method.')
  }

  const args = (params && typeof params === 'object' && !Array.isArray(params))
    ? params as Record<string, unknown>
    : {}

  switch (method) {
    case 'initialize': {
      const asked = args.protocolVersion
      return ok(rpcId, {
        protocolVersion: typeof asked === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(asked)
          ? asked
          : PROTOCOL_VERSION,
        // Only tools. No resources, no prompts, and nothing that pushes: a
        // client that is told otherwise will ask, and be refused.
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      })
    }

    case 'ping':
      return ok(rpcId, {})

    case 'tools/list':
      return ok(rpcId, { tools: toolListing() })

    case 'tools/call': {
      const name = args.name
      if (typeof name !== 'string' || !name) {
        return rpcError(rpcId, RPC_INVALID_PARAMS, 'tools/call needs a tool `name`.')
      }
      return ok(rpcId, await callTool(name, args.arguments))
    }

    default:
      return rpcError(rpcId, RPC_METHOD_NOT_FOUND,
        `This server does not implement "${method}". It offers tools only: `
        + 'initialize, ping, tools/list, tools/call.')
  }
}
