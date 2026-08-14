import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeExecutable } from './claudeExecutable'
import { patchSession, findSession } from './sessions'
import { worktreeDiff } from './worktrees'
import { readRun, getActive } from './runStore'
import { readPreferences } from './preferences'

/**
 * What a session did, in a sentence anybody can read.
 *
 * The list could already tell you a session changed four files and took three
 * turns. Neither says what it *did*, and that is the thing you need to decide
 * whether to look closer — especially with six sessions open, where nobody
 * reads six diffs, and doubly so for someone who does not read diffs at all.
 *
 * Written by a small model from the session's own diff and its last answer.
 * Measured at just under a cent per turn and a few seconds — small next to the
 * turn that produced the work, but not nothing, which is why it is a
 * preference and why its cost is reported on the spend page rather than
 * disappearing into the background.
 */

export interface SessionSummary {
  /** One sentence, plain language, no markdown. */
  text: string
  /** The workspace state this describes — same fingerprint the checks use. */
  fingerprint: string
  costUsd: number
  at: number
}

/**
 * Small and fast on purpose. This runs after every turn that changed
 * something, so a slow or expensive model here would be a tax on the whole
 * app rather than a convenience.
 */
const SUMMARY_MODEL = 'claude-haiku-4-5-20251001'

/** Beyond this it stops being a summary and starts being another thing to read. */
const MAX_CHARS = 160

const PROMPT = `Below is what one coding session changed in a repository, and the last thing it said.

Write ONE sentence, at most 20 words, saying what the session did — in plain language a non-programmer could follow. Lead with the change, not with "the session" or "this".

Rules:
- Describe what changed, not how many files.
- No markdown, no quotes, no trailing period is fine either way.
- If the work looks incomplete or it only investigated without changing anything, say that plainly.
- Reply with the sentence and nothing else.`

function clip(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

/**
 * Strip the things a small model adds when it is being helpful — a leading
 * label, wrapping quotes, a stray bullet. Cheaper and more reliable than
 * asking it again.
 */
export function cleanSummary(raw: string): string {
  let text = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)[0] ?? ''

  text = text
    .replace(/^(summary|answer|sentence)\s*[:\-—]\s*/i, '')
    .replace(/^[-*>\s]+/, '')
    .replace(/^["'“”'']+|["'“”'']+$/g, '')
    .trim()

  return clip(text, MAX_CHARS)
}

/** The material a summary is written from, kept small enough to stay cheap. */
async function gatherContext(sessionId: string): Promise<string | null> {
  const session = await findSession(sessionId)
  if (!session) return null

  const { files } = await worktreeDiff(session.worktreePath, session.baseSha || session.baseBranch)
  if (!files.length) return null

  const changed = files
    .slice(0, 30)
    .map(f => `  ${f.path} (+${f.added} -${f.removed})`)
    .join('\n')
  const more = files.length > 30 ? `\n  …and ${files.length - 30} more files` : ''

  const lastRunId = session.runIds.at(-1)
  const lastRun = lastRunId ? getActive(lastRunId)?.run ?? await readRun(lastRunId) : null
  // The agent's closing message is usually the best available account of
  // intent; the diff alone cannot say why something changed.
  const said = lastRun?.output ? clip(lastRun.output, 1500) : ''

  return [
    `It was asked to: ${clip(session.title, 200)}`,
    '',
    `Files changed:\n${changed}${more}`,
    said ? `\nWhat it said when it finished:\n${said}` : '',
  ].join('\n')
}

/** Sessions being summarised now, so a second request joins rather than duplicates. */
const inFlight = new Map<string, Promise<SessionSummary | null>>()

/**
 * Write the summary for a session and keep it on the record.
 *
 * Returns null when there is nothing to describe or the model could not be
 * reached — an absent summary is a row that shows what it always showed, which
 * is a perfectly acceptable outcome for a convenience.
 */
export async function summariseSession(
  sessionId: string,
  fingerprint: string,
): Promise<SessionSummary | null> {
  const existing = inFlight.get(sessionId)
  if (existing) return existing

  const attempt = (async (): Promise<SessionSummary | null> => {
    const context = await gatherContext(sessionId)
    if (!context) return null

    let text = ''
    let costUsd = 0

    for await (const message of query({
      prompt: context,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable(),
        model: SUMMARY_MODEL,
        maxTurns: 1,
        // Nothing to do but write a sentence. Handing it the toolset would let
        // it go reading the repository, which is slower, dearer, and not what
        // was asked.
        allowedTools: [],
        permissionMode: 'plan',
        // A bare instruction, not Claude Code's preset. The preset is thousands
        // of tokens about tools and conventions that have no bearing on writing
        // one sentence, and it is billed on every turn that changes a file —
        // sending it made this cost about a cent instead of a tenth of one.
        systemPrompt: PROMPT,
        // Nothing here should read the user's CLAUDE.md or project settings:
        // this is a fixed internal task, not a run on their behalf.
        settingSources: [],
      },
    })) {
      if ('result' in message) {
        text = (message as { result?: string }).result ?? ''
        costUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0
      }
    }

    const cleaned = cleanSummary(text)
    if (!cleaned) return null

    const summary: SessionSummary = { text: cleaned, fingerprint, costUsd, at: Date.now() }
    await patchSession(sessionId, { summary })
    return summary
  })()

  inFlight.set(sessionId, attempt)
  try {
    return await attempt
  } catch {
    // A summary is a nicety. Losing one must never disturb the turn that
    // produced the work it was describing.
    return null
  } finally {
    inFlight.delete(sessionId)
  }
}

/**
 * Summarise after a turn, unless the person has turned this off.
 *
 * Off is a real choice: this spends money on every turn that changes files,
 * and somebody who reads their own diffs is paying for something they will
 * never look at.
 */
export async function summariseAfterTurn(sessionId: string, fingerprint: string): Promise<void> {
  try {
    const prefs = await readPreferences()
    if (prefs.summariseSessions === false) return

    await summariseSession(sessionId, fingerprint)
  } catch {
    // As above: never take a completed turn down with it.
  }
}
