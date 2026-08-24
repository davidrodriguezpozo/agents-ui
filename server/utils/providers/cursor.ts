import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { systemPromptFor, type ResolvedRunOptions } from '../runOptions'
import { toSettingsPermissions } from '../permissionRules'
import { refusedHostsIn } from '../sandboxViolations'
import { paragraphBreaks } from '../textBlocks'
import { cursorAgentExecutable } from '../cursorAgentExecutable'
import { turnsStoppedMessage } from '../budget'
import { notify, runPath } from '../notify'
import type { Run, RunEvent } from '../runStore'
import type { Provider, ProviderTurn } from './types'

/**
 * Cursor, through `cursor-agent`.
 *
 * The second agent behind the seam, and the one that proves the seam is real:
 * everything downstream of a turn — the worktree, the merge train, the reviews,
 * the ledger — sees `RunEvent`s and never learns which CLI produced them.
 *
 * **Everything here was written against a recorded stream, not against the
 * flags.** `test/fixtures/cursor-stream-*.jsonl` are three real runs in a
 * scratch repository — a read and an edit, a resumed turn with a shell call, and
 * a run whose tool calls were refused by policy. Guessing the event shape from
 * `--help` is how an adapter fails quietly, and two of the rules below are ones
 * no flag name would have suggested:
 *
 *   - **An `assistant` event is a text delta only when it has `timestamp_ms`
 *     and no `model_call_id`.** Cursor re-sends each completed block whole — once
 *     stamped with the model call that produced it, and once more at the end of
 *     the stream with no timestamp at all. Emitting every `assistant` event
 *     tripled the answer.
 *   - **A refused tool call is a `result.rejected`, not an error.** The run still
 *     ends `subtype: "success"`, so a turn that was allowed to do nothing reads
 *     as a clean pass unless the rejections are counted. They are, as permission
 *     denials, which is what they are.
 *
 * **Three things do not port, and all three are said out loud rather than
 * emulated.** See `capabilities` at the bottom: no `canUseTool` so no prompting,
 * no open stdin so no steering, and no `total_cost_usd` so no cost.
 *
 * **The limits are the fourth, and they split.** `cursor-agent` has neither a
 * turn limit nor a budget flag, which left a Cursor session unbounded in a way a
 * Claude one is not — the worst kind of gap in an app whose premise is leaving
 * work running unattended. The two halves have different answers:
 *
 *   - **Turns are enforced here**, by counting model calls and killing the
 *     process on the one past the limit. Not as good as the CLI doing it — the
 *     turn is cut rather than declined — but it is a real bound, and it produces
 *     the same `stoppedBy: 'turns'` ending the Claude path does.
 *   - **A dollar budget cannot be**, and no arithmetic here can change that: the
 *     limit is in dollars and nothing reports what a turn cost. Enforcing a token
 *     ceiling derived from a price table would be a limit whose number came from
 *     a guess, which is worse than a limit that says it does not apply. So it
 *     says it does not apply — see `reportsCostUsd`, the settings page, and the
 *     lines the session picker shows before a session is created.
 */

/**
 * Cursor's tool calls, in Claude Code's vocabulary.
 *
 * Deliberately translated rather than passed through, and it buys more than
 * tidy labels. `outcomes.ts` decides whether a turn changed any files by looking
 * for `Write`/`Edit` in the event log, and `app/utils/toolCalls.ts` renders a
 * step from `file_path`, `command`, `pattern`. A `cursor:edit` carrying a `path`
 * would have been a blank row in the work rail and a night of real work counted
 * as a night of reading.
 *
 * Anything unmapped keeps its own name in a readable form — an unknown tool
 * renders as its own verb, which is better than being forced into a wrong one.
 */
const TOOL_NAMES: Record<string, string> = {
  shellToolCall: 'Bash',
  writeShellStdinToolCall: 'Bash',
  readToolCall: 'Read',
  editToolCall: 'Edit',
  applyAgentDiffToolCall: 'Edit',
  writeToolCall: 'Write',
  deleteToolCall: 'Bash',
  lsToolCall: 'Glob',
  globToolCall: 'Glob',
  grepToolCall: 'Grep',
  semSearchToolCall: 'Grep',
  webSearchToolCall: 'WebSearch',
  webFetchToolCall: 'WebFetch',
  updateTodosToolCall: 'TodoWrite',
  readTodosToolCall: 'TodoWrite',
  taskToolCall: 'Task',
  mcpToolCall: 'Task',
}

/** `readLintsToolCall` → `ReadLints`, for the ones nothing maps. */
function fallbackToolName(key: string): string {
  const stem = key.replace(/ToolCall$/, '')
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

export function toolNameOf(key: string): string {
  return TOOL_NAMES[key] ?? fallbackToolName(key)
}

/**
 * The one argument the UI reads by a different name.
 *
 * Cursor says `path` where Claude Code says `file_path`, and `describeToolCall`
 * matches on the latter. Added beside the original rather than renamed, so
 * nothing about the call is lost from the record.
 */
function toolInput(args: Record<string, unknown> | undefined): unknown {
  if (!args) return {}
  const path = args.path
  return typeof path === 'string' ? { ...args, file_path: path } : args
}

/** The tool call in a `tool_call` event, whatever kind it is. */
function toolCallOf(message: Record<string, unknown>): {
  key: string
  args?: Record<string, unknown>
  result?: Record<string, unknown>
} | null {
  const call = message.tool_call
  if (!call || typeof call !== 'object') return null

  for (const [key, value] of Object.entries(call as Record<string, unknown>)) {
    if (!key.endsWith('ToolCall') || !value || typeof value !== 'object') continue
    const body = value as { args?: Record<string, unknown>; result?: Record<string, unknown> }
    return { key, args: body.args, result: body.result }
  }

  return null
}

/**
 * A `call_id` arrives with a newline in it — two ids concatenated. It is only
 * ever used to pair a started event with its completed one, so it needs to be
 * stable rather than pretty, but it also ends up in the run log where a stray
 * line break would break a row in half.
 */
function callId(message: Record<string, unknown>): string {
  return String(message.call_id ?? '').replace(/\s+/g, ' ').trim()
}

function previewOf(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

/**
 * What a finished tool call says for itself.
 *
 * Three shapes, and the middle one is the one that matters: `rejected` is how a
 * policy refusal arrives, and it carries an empty `reason` — so the sentence a
 * reader needs has to be written here. Left as Cursor sends it, the run log said
 * a command had been refused and gave no hint that it was refusable.
 */
function resultOf(
  result: Record<string, unknown> | undefined,
  toolName: string,
): { isError: boolean; rejected: boolean; text: string } {
  if (!result) return { isError: false, rejected: false, text: '' }

  if (result.rejected) {
    const rejected = result.rejected as { command?: string; reason?: string }
    const what = rejected.command ? `\`${rejected.command}\`` : toolName
    return {
      isError: true,
      rejected: true,
      text: rejected.reason?.trim()
        || `${what} was refused: this run was not granted it, and Cursor cannot stop to ask.`,
    }
  }

  const body = result.success ?? result.error ?? result
  const isError = Boolean(result.error)

  if (typeof body === 'string') return { isError, rejected: false, text: body }
  if (!body || typeof body !== 'object') return { isError, rejected: false, text: '' }

  const fields = body as Record<string, unknown>
  // Best first: what a shell printed, what a file held, what an edit did.
  for (const key of ['stdout', 'content', 'message', 'diffString', 'result', 'error']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim()) return { isError, rejected: false, text: value }
  }

  return { isError, rejected: false, text: '' }
}

export interface MappedMessage {
  events: Omit<RunEvent, 'seq' | 'at'>[]
  patch?: Partial<Run>
}

const NOTHING: MappedMessage = { events: [] }

/**
 * The whole of the translation, as a function over parsed lines.
 *
 * Separated from the spawn on purpose: this is the part with the decisions in
 * it, so this is the part the recorded fixtures are run through in
 * `test/providers/cursorStream.test.ts`. Nothing here does I/O.
 */
export function createCursorMapper(options: ResolvedRunOptions) {
  const breaks = paragraphBreaks()
  /** Tool name by call id, so a result can say what it was the result of. */
  const nameById = new Map<string, string>()
  /** The command each shell call ran, for the sandbox's benefit. See `claude.ts`. */
  const commandById = new Map<string, string>()
  /** Refused by policy. Counted as denials, because that is what they are. */
  const denied: string[] = []
  /** Distinct model calls — the closest honest thing to a turn count. */
  const modelCalls = new Set<string>()
  let model: string | undefined
  let sawResult = false

  return {
    /** Set once the turn reported its own ending. */
    get complete(): boolean {
      return sawResult
    },

    /**
     * Model calls seen so far — the nearest thing Cursor reports to a turn, and
     * what the turn limit is enforced against. Read after every message, because
     * the whole point is to stop part-way rather than to notice afterwards.
     */
    get turns(): number {
      return modelCalls.size
    },

    /**
     * The stats for a turn that was stopped before it reported its own.
     *
     * The token counts are zero and unknowable rather than zero and measured:
     * Cursor sends `usage` only in the final `result`, which a stopped turn never
     * reaches. Saying so is the honest option — the alternative is estimating
     * from the text we happened to see, which would be a number with nothing
     * behind it in the same field that elsewhere holds a real one.
     */
    partialStats() {
      return {
        usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        costUsd: 0,
        durationMs: 0,
        numTurns: modelCalls.size,
        model: model ?? options.model,
        permissionDenials: denied.map(toolName => ({ toolName })),
      }
    },

    take(message: unknown): MappedMessage {
      if (!message || typeof message !== 'object') return NOTHING
      const msg = message as Record<string, unknown>
      const type = String(msg.type ?? '')
      const subtype = msg.subtype ? String(msg.subtype) : undefined

      if (typeof msg.model_call_id === 'string') modelCalls.add(msg.model_call_id)

      if (type === 'system' && subtype === 'init') {
        // The id every turn after this one resumes with. `sdkSessionId` means
        // "the id this provider resumes with" — see the note on the field.
        if (typeof msg.model === 'string') model = msg.model
        const sessionId = msg.session_id
        return typeof sessionId === 'string' && sessionId
          ? { events: [], patch: { sdkSessionId: sessionId } }
          : NOTHING
      }

      if (type === 'thinking') {
        if (subtype === 'completed') {
          breaks.startBlock('thinking')
          return NOTHING
        }
        const text = typeof msg.text === 'string' ? breaks.delta('thinking', msg.text) : ''
        return text ? { events: [{ type: 'thinking', text }] } : NOTHING
      }

      if (type === 'assistant') {
        // The delta rule, and the reason this file exists. A block with a
        // `model_call_id` is Cursor repeating what it already streamed; one with
        // no `timestamp_ms` is the same repeat again at the end of the stream.
        if (msg.model_call_id !== undefined || msg.timestamp_ms === undefined) return NOTHING

        const content = (msg.message as { content?: unknown[] } | undefined)?.content ?? []
        const raw = content
          .map(block => (block as { type?: string; text?: string })?.type === 'text'
            ? (block as { text?: string }).text ?? ''
            : '')
          .join('')

        const text = raw ? breaks.delta('text', raw) : ''
        return text ? { events: [{ type: 'text', text }] } : NOTHING
      }

      if (type === 'tool_call') {
        const call = toolCallOf(msg)
        if (!call) return NOTHING
        const id = callId(msg)

        if (subtype === 'started') {
          const toolName = toolNameOf(call.key)
          nameById.set(id, toolName)
          const command = call.args?.command
          if (typeof command === 'string') commandById.set(id, command)
          // Cursor has no `content_block_start`, so a tool call is the only
          // signal that the answer resumes in a new block afterwards. Without
          // this the last sentence before a tool is glued to the first word
          // after it — see `textBlocks`.
          breaks.startBlock('text')
          return { events: [{ type: 'tool_use', id, toolName, input: toolInput(call.args) }] }
        }

        if (subtype !== 'completed') return NOTHING

        const toolName = nameById.get(id) ?? toolNameOf(call.key)
        const { isError, rejected, text } = resultOf(call.result, toolName)
        const patch: Partial<Run> = {}

        if (rejected) {
          denied.push(toolName)
          // Nobody could have approved it: the policy was fixed when the
          // process was spawned. So this is flagged the way an unattended
          // Claude refusal is — the work is incomplete and a person has to know.
          patch.needsAttention = true
          patch.deniedTools = [...new Set(denied)]
        }

        // Same question the Claude path asks, for the same reason, and only
        // when the sandbox is actually on — see the note in `claude.ts`.
        if (options.sandbox.enabled) {
          const refused = refusedHostsIn(commandById.get(id) ?? '', text, {
            allowed: options.sandbox.allowedDomains,
          })
          if (refused.length) patch.refusedHosts = refused
        }

        return {
          events: [{ type: 'tool_result', id, isError, preview: previewOf(text) }],
          ...(Object.keys(patch).length ? { patch } : {}),
        }
      }

      if (type === 'result') {
        sawResult = true
        const usage = (msg.usage ?? {}) as Record<string, unknown>
        const num = (value: unknown): number => typeof value === 'number' ? value : 0

        const stats = {
          usage: {
            input: num(usage.inputTokens),
            output: num(usage.outputTokens),
            cacheRead: num(usage.cacheReadTokens),
            cacheCreation: num(usage.cacheWriteTokens),
          },
          /**
           * Zero, and left at zero deliberately. `cursor-agent` reports no
           * `total_cost_usd`, and multiplying tokens by a price nobody here can
           * keep current would put an invented figure in the ledger. The spend
           * page reads `reportsCostUsd` and says the cost is unreported rather
           * than saying it was nothing — see `outcomes.ts`.
           */
          costUsd: 0,
          durationMs: num(msg.duration_ms),
          // Model calls, which is the nearest thing Cursor reports to a turn.
          numTurns: modelCalls.size,
          model: model ?? options.model,
          permissionDenials: denied.map(toolName => ({ toolName })),
        }

        const text = typeof msg.result === 'string' && msg.result.trim()
          ? msg.result
          : 'The run ended without a final answer.'

        return {
          events: [{ type: 'result', text, stats }],
          patch: { stats, output: text },
        }
      }

      // `user` is our own prompt coming back, and anything else is Cursor
      // saying something this app has no use for yet. Both are silence.
      return NOTHING
    },
  }
}

/**
 * The command line for one turn.
 *
 * Pure, so `test/providers/cursorArgs.test.ts` can assert the two things that
 * are easy to get wrong and invisible when wrong: that `--resume` is there on
 * turn two and absent on turn one, and that `--force` is never there unless the
 * session was deliberately set to skip its own prompts.
 */
export function cursorArgs(options: ResolvedRunOptions, resumeSessionId?: string | null): string[] {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    // Without it, Cursor sends each block once, whole, at the end. The turn
    // would still be correct and would arrive with nothing streaming.
    '--stream-partial-output',
    // This worktree was cut by this app from a repository the person chose. The
    // alternative is a trust prompt in a headless process, which nothing can
    // answer.
    '--trust',
  ]

  // A conversation rather than a series of unrelated runs, exactly as `resume`
  // is for Claude Code. Absent on the first turn, which is what starts one.
  if (resumeSessionId) args.push('--resume', resumeSessionId)

  if (options.model) args.push('--model', options.model)

  // Readable alongside `cwd`. Git still happens in `cwd`, so a worktree stays a
  // worktree.
  for (const dir of options.additionalDirectories) args.push('--add-dir', dir)

  args.push('--sandbox', options.sandbox.enabled ? 'enabled' : 'disabled')

  /**
   * `--force` allows everything the deny list does not name, and it is here for
   * exactly one reason: a session whose trust was deliberately set to Auto. That
   * is the same session for which the Claude path answers every prompt `allow`
   * before it looks at anything else, so refusing it here would make the same
   * choice mean two different things depending on which agent ran.
   *
   * Every other run gets the allow list and nothing more. A run that cannot get
   * moving does not widen its own policy to get moving; it refuses.
   */
  if (options.permissionMode === 'bypassPermissions') args.push('--force')

  // Mirrors `loadSettings`, which is what decides whether Claude Code reads the
  // settings files around the project.
  if (!options.loadSettings) args.push('--disable-project-configs')

  return args
}

/**
 * The policy this run is allowed, as Cursor's own config file.
 *
 * There is no flag for this — `cursor-agent` headless has no `canUseTool` and no
 * `--allow`, only a policy read from `cli-config.json` at startup. Three ways to
 * get one there, and only the third is acceptable:
 *
 *   - Writing the user's `~/.cursor/cli-config.json` would change what their own
 *     terminal is allowed to do, for as long as they have it installed.
 *   - Writing `.cursor/cli.json` in the worktree — which Cursor does read, and
 *     merges over the global config — would put a file in the repository that
 *     `git status` shows and the merge train could land.
 *   - `CURSOR_CONFIG_DIR` moves the whole config directory. Verified on this
 *     machine: the login survives it, because credentials are in the keychain,
 *     and `CURSOR_DATA_DIR` is separate, so chats stay where they are and
 *     `--resume` still finds them.
 *
 * So each turn gets a directory of its own, holding nothing but the rules this
 * app already resolved. `toSettingsPermissions` is the same function that builds
 * the Claude Code settings, and it already produces `Shell(git status)`, which is
 * already the shape Cursor stores.
 */
export function cursorConfig(options: ResolvedRunOptions): Record<string, unknown> {
  const settings = toSettingsPermissions(options.allowRules)

  return {
    version: 1,
    permissions: settings?.permissions ?? { allow: [], deny: [] },
    // The mode that consults the list above. Cursor's own default, named here
    // so a change to its default cannot quietly change ours.
    approvalMode: 'allowlist',
  }
}

/**
 * The prompt for one turn.
 *
 * `cursor-agent` has no `--append-system-prompt`, so an agent's instructions and
 * the standing brief have nowhere to go but the first thing the conversation
 * reads — which makes this a *message*, not a system prompt, and the difference
 * decides the next line.
 *
 * On a resume it is left off entirely, and `systemPromptFor(options, true)` is
 * deliberately not what does that: that function drops only the standing brief
 * and keeps the agent's instructions, which is right for Claude Code, where the
 * system prompt is a separate channel re-sent whole on every turn. Here there is
 * no separate channel. Sending it again would append the agent's instructions to
 * the conversation a second time, as something the *user* apparently said, on
 * every turn of a long session.
 *
 * So: the whole of it on a cold start, none of it afterwards. The conversation
 * holds it either way.
 */
export function cursorPrompt(
  options: ResolvedRunOptions,
  input: string,
  resumeSessionId?: string | null,
): string {
  if (resumeSessionId) return input

  const system = systemPromptFor(options, false)
  return system ? `${system}\n\n---\n\n${input}` : input
}

/** NDJSON, split without assuming a line fits in one chunk. An edit carries a whole file. */
function lines(chunk: string, carry: { rest: string }): string[] {
  const parts = (carry.rest + chunk).split('\n')
  carry.rest = parts.pop() ?? ''
  return parts.filter(line => line.trim())
}

async function runTurn(turn: ProviderTurn): Promise<void> {
  const { run, options, emit, patch, abort } = turn

  if (turn.images?.length) {
    // Said once, in the log, rather than dropped in silence. Cursor's headless
    // input is text; the words still go, the pictures do not.
    emit({
      type: 'text',
      text: `_${turn.images.length} image${turn.images.length === 1 ? '' : 's'} could not be sent: `
        + 'Cursor takes text only in this mode._',
    })
  }

  const executable = cursorAgentExecutable()
  const configDir = await mkdtemp(join(tmpdir(), 'agents-ui-cursor-'))

  try {
    await writeFile(
      join(configDir, 'cli-config.json'),
      `${JSON.stringify(cursorConfig(options), null, 2)}\n`,
      'utf8',
    )

    const args = cursorArgs(options, turn.resumeSessionId)
    const mapper = createCursorMapper(options)

    const child = spawn(executable, args, {
      cwd: options.cwd,
      // Spread rather than added to, so nothing the run needs is missing, and
      // the config directory above is the only thing changed.
      env: { ...process.env, CURSOR_CONFIG_DIR: configDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    /** Stopping a run has to stop the process, or it keeps working and paying. */
    const stop = () => child.kill('SIGTERM')
    abort.signal.addEventListener('abort', stop, { once: true })

    /**
     * Set when *we* ended the turn rather than Cursor doing so.
     *
     * Load-bearing below: without it the missing `result` reads as the process
     * having died, and a run this app deliberately stopped would be reported as
     * a failure with somebody else's error message on it.
     */
    let stoppedBy: 'turns' | null = null

    // The prompt goes on stdin rather than in argv: a first turn carries the
    // agent's instructions and the standing brief, which is more than a command
    // line is guaranteed to hold. Closing it is what tells Cursor to begin.
    child.stdin.end(cursorPrompt(options, run.input, turn.resumeSessionId), 'utf8')

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      // Bounded: a failing run can print without limit, and the useful part is
      // the first thing it said.
      if (stderr.length < 8_000) stderr += chunk.toString('utf8')
    })

    const carry = { rest: '' }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      for (const line of lines(chunk, carry)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          // Not every line is ours — a warning on stdout is not a turn ending.
          continue
        }

        const { events, patch: fields } = mapper.take(parsed)
        for (const event of events) emit(event)

        /**
         * The turn limit, enforced here because there is nowhere else to enforce
         * it: `cursor-agent` has no `--max-turns`, so a run that decides to loop
         * loops until the account stops it. Claude Code stops itself and reports
         * `error_max_turns`; this is the same ending, reached by counting model
         * calls and killing the process on the one past the limit.
         *
         * `>` rather than `>=`, and the overshoot that follows is not a bug worth
         * "fixing" by clamping: a limit of one has to allow one turn, and the only
         * evidence that a further turn has begun is that it has begun. So a run
         * stopped at a limit of one reports `numTurns: 2` — two calls were
         * started, which is what happened, and a count edited down to the limit
         * would be the record agreeing with the setting rather than with the run.
         *
         * Checked before the patch below rather than after, so the turn that
         * broke the limit does not also get to record its work as though it had
         * been allowed.
         */
        if (!stoppedBy && mapper.turns > options.maxTurns) {
          stoppedBy = 'turns'
          stop()
          return
        }

        if (fields) {
          // Merged rather than overwritten: two refused hosts in one turn are
          // both refused, and the same is true of denied tools.
          patch({
            ...fields,
            ...(fields.refusedHosts
              ? { refusedHosts: [...new Set([...(run.refusedHosts ?? []), ...fields.refusedHosts])] }
              : {}),
            ...(fields.deniedTools
              ? { deniedTools: [...new Set([...(run.deniedTools ?? []), ...fields.deniedTools])] }
              : {}),
          })
        }
      }
    })

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })

    abort.signal.removeEventListener('abort', stop)

    if (abort.signal.aborted) return

    /**
     * Stopped part-way rather than finished, which is the same situation as a run
     * refused a tool it needed — so it is flagged the same way and does not read
     * as a clean success. The fields are the ones the Claude path sets, so the
     * work rail's "Ran out of turns" and the run page's "Change the limits"
     * button work on a Cursor run without knowing it is one.
     */
    if (stoppedBy === 'turns') {
      const stats = mapper.partialStats()
      const text = turnsStoppedMessage(options.maxTurns)

      patch({ stats, output: text, needsAttention: true, stoppedBy: 'turns' })
      emit({ type: 'result', text, stats })

      // Same notification the Claude path sends for the same ending. A run that
      // stopped short is the kind of thing you want to hear about rather than
      // find later at the bottom of a list.
      await notify(
        'failed',
        `${run.title} stopped early`,
        'It reached its turn limit.',
        runPath(run),
      )
      return
    }

    /**
     * A turn can end without a `result`, and this is not theoretical — it
     * happened on the second capture, where the model provider was briefly
     * unreachable: two lines of stream, exit 1, and the only account of what
     * went wrong on stderr. Reported as a failure, because it was one. Without
     * this the run completed, with no output and nothing saying why.
     */
    if (!mapper.complete) {
      throw new Error(
        stderr.trim().split('\n').find(Boolean)?.slice(0, 600)
          || `cursor-agent exited with code ${code} before finishing the turn.`,
      )
    }
  } finally {
    await rm(configDir, { recursive: true, force: true }).catch(() => null)
  }
}

export const cursorProvider: Provider = {
  id: 'cursor',
  label: 'Cursor',
  capabilities: {
    /** No stdin stays open past the prompt, so `liveSteer` has nothing to write to. */
    canSteer: false,
    /** Headless `cursor-agent` has no `canUseTool`; the policy is fixed at spawn. */
    canPromptForPermission: false,
    /** No `total_cost_usd`. Tokens are recorded; the cost is not invented. */
    reportsCostUsd: false,
  },
  runTurn,
}
