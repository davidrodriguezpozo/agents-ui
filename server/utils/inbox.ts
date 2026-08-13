import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * Work waiting for you somewhere that is not this machine.
 *
 * The Now queue already answers "what needs me" for sessions, rituals and pull
 * requests. Everything else a day is made of — a Notion ticket with your name
 * on it, a Slack thread someone is waiting on — is reachable, because Claude
 * has MCP servers for all of it. What was missing was a surface.
 *
 * **Why this is a store and not a poll.** The obvious design is to ask on a
 * timer, and it does not work: the spike that proved this possible took 155
 * seconds, because answering "what is assigned to me in Notion" means finding
 * the database, working out which person is you, and querying it. That is a
 * job, not a request. So a *run* produces findings and writes them here, and
 * the queue reads what was written — instantly, and at no cost.
 *
 * Which makes an inbox source the same shape as everything else this app does
 * well: leave it running, come back to what it found. A ritual can refresh it
 * on a schedule; the button on the queue refreshes it now.
 *
 * **Why sources are project-scoped.** MCP reachability depends on the working
 * directory: from one of this machine's projects Notion answers, from another
 * it is not configured at all. A source therefore records the project it was
 * asked from, and says so when it has never been able to run.
 */

export interface InboxItem {
  /** Stable across refreshes, so a dismissal sticks. Derived from the URL. */
  id: string
  title: string
  url: string
  /** Why it wants you, in the words the model used. Shown verbatim. */
  why: string
}

export interface InboxSourceState {
  /** Matches a key in `INBOX_SOURCES`. */
  source: string
  items: InboxItem[]
  /** When the last refresh finished, successful or not. */
  checkedAt?: number
  /** What that refresh cost, so the price of asking is never hidden. */
  costUsd?: number
  durationMs?: number
  /** Set when the last refresh failed. Kept alongside the previous items. */
  error?: string
  /** The project it was asked from — MCP answers differ per directory. */
  projectDir?: string
  /** Ids the reader has waved away. Survives refreshes. */
  dismissed?: string[]
}

export interface Inbox {
  sources: InboxSourceState[]
}

/**
 * A question worth asking somewhere else, and the tools it may use to answer.
 */
export interface InboxSource {
  key: string
  label: string
  /** The MCP server this needs, as `claude mcp list` names it. */
  requires: string
  /** Pre-approved so an unattended refresh is not waiting on a prompt. */
  tools: string[]
  prompt: string
  icon: string
}

/**
 * What an inbox refresh may not touch, and why it is a deny-list.
 *
 * An allow-list does not work here, and both obvious attempts were measured
 * rather than assumed:
 *
 *   - `--allowedTools <mcp tools only>`: the spike grepped `~/.claude/plugins`
 *     to work out a Notion database id. Reasonable of it. Not something an
 *     unattended refresh should be able to do.
 *   - `--tools ""`, documented as "use \"\" to disable all tools": asked to run
 *     `echo`, it ran `echo`.
 *
 * `--disallowedTools Bash` refused. So the only thing that actually holds is
 * naming what is forbidden. MCP tools are untouched by this — they are prefixed
 * `mcp__` and none of them are listed — which is exactly the intent: this run
 * may talk to Notion or Slack, and may not touch the machine it runs on.
 */
export const INBOX_DENIED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  // A subagent is a way to get all of the above back.
  'Task',
]

const SHAPE = 'Reply with ONLY a JSON array and nothing else — no prose, no code fence. '
  + 'Each element must be {"title":string,"url":string,"why":string}, where `why` is one '
  + 'sentence saying why it is waiting on this person. Return [] if nothing is, or if you '
  + 'cannot tell who this person is. Never guess.'

export const INBOX_SOURCES: InboxSource[] = [
  {
    key: 'notion',
    label: 'Notion',
    requires: 'notion',
    tools: [
      'mcp__notion__notion-search',
      'mcp__notion__notion-fetch',
      'mcp__notion__notion-query-data-sources',
      'mcp__notion__notion-query-database-view',
    ],
    icon: 'i-lucide-file-text',
    prompt: 'Find up to 8 Notion pages, tickets or tasks that are assigned to me, '
      + 'or where a next step is explicitly waiting on me. Ignore anything already done, '
      + `closed or assigned to somebody else. ${SHAPE}`,
  },
  {
    key: 'slack',
    label: 'Slack',
    requires: 'claude.ai Slack',
    tools: [
      'mcp__claude_ai_Slack__slack_search_public_and_private',
      'mcp__claude_ai_Slack__slack_read_thread',
      'mcp__claude_ai_Slack__slack_read_channel',
      'mcp__claude_ai_Slack__slack_read_user_profile',
    ],
    icon: 'i-lucide-message-square',
    prompt: 'Find up to 8 Slack messages or threads from the last three days where somebody '
      + 'is waiting on a reply from me — I was asked a direct question, mentioned with a '
      + 'request, or am the one holding something up. Ignore anything I have already answered, '
      + `and ignore broadcast announcements nobody expects a reply to. ${SHAPE}`,
  },
]

export function findInboxSource(key: string): InboxSource | undefined {
  return INBOX_SOURCES.find(source => source.key === key)
}

export const inboxStore = defineJsonStore<Inbox>({
  label: 'inbox',
  path: () => join(getClaudeDir(), 'agents-ui', 'inbox.json'),
  empty: () => ({ sources: [] }),
  decode: (parsed: any) => ({
    sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
  }),
  encode: value => value,
})

/**
 * An id that survives a refresh.
 *
 * The URL is the only thing about one of these that is stable — a title gets
 * edited and the `why` is rewritten every time it is asked. Dismissals are
 * keyed on this, so waving something away has to outlive the wording.
 */
export function inboxItemId(url: string): string {
  return url.trim().replace(/[?#].*$/, '').toLowerCase()
}

/**
 * What a model replied, as items — or an explanation of why it was not usable.
 *
 * Kept separate from the running of it so the shape of a reply can be tested
 * without spending two minutes and somebody's tokens on each case.
 */
export function parseInboxReply(reply: string): { items: InboxItem[] } | { error: string } {
  const trimmed = (reply ?? '').trim()
  if (!trimmed) return { error: 'It returned nothing.' }

  // A bare array is what was asked for; a fenced or prefaced one is what often
  // arrives. Both are the model being helpful and only one of them parses.
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return { error: `It did not answer with a list. It said: ${trimmed.slice(0, 200)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch (e) {
    return { error: `Its answer was not readable JSON (${(e as Error).message}).` }
  }

  if (!Array.isArray(parsed)) return { error: 'Its answer was not a list.' }

  const items: InboxItem[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const url = typeof entry.url === 'string' ? entry.url.trim() : ''
    const title = typeof entry.title === 'string' ? entry.title.trim() : ''
    // No URL means there is nowhere for the row to go, which makes it a claim
    // rather than a task. Dropped rather than shown as a dead end.
    if (!url || !title) continue

    items.push({
      id: inboxItemId(url),
      title,
      url,
      why: typeof entry.why === 'string' && entry.why.trim()
        ? entry.why.trim()
        : 'Waiting on you.',
    })
  }

  // Same page found twice — once by search, once by a database query — is one
  // thing to do.
  const seen = new Set<string>()
  return { items: items.filter(item => (seen.has(item.id) ? false : seen.add(item.id))) }
}

/** The findings a source has, minus anything waved away. */
export function visibleItems(state: InboxSourceState | undefined): InboxItem[] {
  if (!state) return []
  const dismissed = new Set(state.dismissed ?? [])
  return state.items.filter(item => !dismissed.has(item.id))
}
