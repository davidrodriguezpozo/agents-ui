import { buildWorkList, type WorkItem } from '~/utils/workList'
import type { Tone } from './format'
import type {
  InboxSource,
  Project,
  Pull,
  RitualHistory,
  RunSummary,
  Schedule,
  Session,
} from './types'

/**
 * Everything that might want you, as one list.
 *
 * The six views were a browser's navigation model — a sidebar makes pages cheap,
 * so the browser has pages. In a terminal, page-switching is the wrong axis:
 * what you actually want to know is what needs doing, and that question does not
 * care whether the answer is a session, a pull request, a ritual that has failed
 * twice or a message somebody left in Slack. So there is one rail, sorted by how
 * much it wants you, and Work / Land / Daily / Inbox are filters on it rather
 * than places to go.
 *
 * Pure, and it reuses the browser's own vocabulary rather than growing a second
 * opinion: `buildWorkList` still decides what a session's row says, exactly as
 * it does on `/work`.
 */

export type RailKind = 'session' | 'run' | 'pull' | 'ritual' | 'inbox' | 'project'

/**
 * How much a row wants you, which is the only sort order that matters.
 *
 * The wall has its own four-way version of this for tiles; the rail needs more
 * because it spans kinds the wall never sees — a pull request that is ready and
 * a ritual that is merely due are both quiet, and neither is a session waiting
 * on a permission prompt.
 */
export type Urgency = 'needs-you' | 'broken' | 'working' | 'ready' | 'waiting' | 'quiet'

export const URGENCY: { id: Urgency; label: string; tone: Tone }[] = [
  { id: 'needs-you', label: 'Needs you', tone: 'yellow' },
  { id: 'broken', label: 'Broken', tone: 'red' },
  { id: 'working', label: 'Working', tone: 'cyan' },
  { id: 'ready', label: 'Ready to land', tone: 'green' },
  { id: 'waiting', label: 'Waiting elsewhere', tone: 'cyan' },
  { id: 'quiet', label: 'Quiet', tone: 'gray' },
]

const RANK: Record<Urgency, number> = {
  'needs-you': 0,
  broken: 1,
  working: 2,
  ready: 3,
  waiting: 4,
  quiet: 5,
}

export interface RailItem {
  /** `session:abc` — unique across kinds, and what selection is remembered by. */
  key: string
  kind: RailKind
  /** The id to address it by: a session id, a pull number, a path. */
  id: string
  title: string
  /** The quiet second line: a branch, a verdict, what it is doing. */
  detail: string
  /** The short label in the status column. */
  status: string
  urgency: Urgency
  tone: Tone
  at: number
  spinning?: boolean
  repo?: string
  /** Where `o` goes. */
  browserPath?: string
  /**
   * What "has it said anything since I looked" compares against.
   *
   * Left unset for the kinds where the question is meaningless — a project does
   * not talk.
   */
  stamp?: number
}

export type RailFilter = 'all' | 'needs-you' | RailKind

export const FILTERS: { id: RailFilter; chord: string; label: string }[] = [
  { id: 'all', chord: 'a', label: 'Everything' },
  { id: 'needs-you', chord: 'n', label: 'Needs you' },
  { id: 'session', chord: 's', label: 'Sessions' },
  { id: 'pull', chord: 'p', label: 'Pull requests' },
  { id: 'ritual', chord: 'd', label: 'Daily' },
  { id: 'inbox', chord: 'i', label: 'Elsewhere' },
  { id: 'project', chord: 'j', label: 'Projects' },
]

export interface RailInput {
  sessions: Session[]
  runs: RunSummary[]
  pulls: { reviewing: Pull[]; mine: Pull[] } | null
  schedules: Schedule[]
  histories: Record<string, RitualHistory>
  inbox: InboxSource[]
  projects: Project[]
  activeProject: string | null
  scope: string | null
  home: string
}

export function buildRail(input: RailInput): RailItem[] {
  const items: RailItem[] = [
    ...fromWork(input.sessions, input.runs),
    ...fromPulls(input.pulls),
    ...fromRituals(input.schedules, input.histories),
    ...fromInbox(input.inbox),
    ...fromProjects(input.projects, input.activeProject, input.scope, input.home),
  ]

  // Stable: same urgency and same moment must not reorder between polls, or the
  // row under the cursor changes while you are reading it.
  return items.sort((a, b) => (
    RANK[a.urgency] - RANK[b.urgency]
    || b.at - a.at
    || a.key.localeCompare(b.key)
  ))
}

/**
 * Sessions and runs, through the browser's own list builder.
 *
 * Only this project's, because the server works that out per request and a rail
 * headed by one project that lists another's is the kind of thing you notice
 * after acting on the wrong row.
 */
function fromWork(sessions: Session[], runs: RunSummary[]): RailItem[] {
  const here = sessions.filter(session => session.inCurrentProject)
  const byId = new Map(here.map(session => [session.id, session]))

  return buildWorkList({ sessions: here as never, runs: runs as never }).map((item) => {
    const session = sessionOf(item, byId)
    return {
      key: item.key,
      kind: item.key.startsWith('session:') ? 'session' : 'run',
      id: item.key.startsWith('session:') ? item.key.slice('session:'.length) : (item.runId ?? ''),
      title: item.title,
      detail: detailOf(item),
      status: item.outcome,
      urgency: urgencyOfWork(item),
      tone: toneOfWork(item),
      at: item.at,
      spinning: item.status === 'running',
      browserPath: item.to,
      stamp: Math.max(item.at, session?.updatedAt ?? 0),
    }
  })
}

function sessionOf(item: WorkItem, byId: Map<string, Session>): Session | undefined {
  return item.key.startsWith('session:') ? byId.get(item.key.slice('session:'.length)) : undefined
}

function detailOf(item: WorkItem): string {
  return [
    item.detail,
    item.changedFiles ? `${item.changedFiles} file${item.changedFiles === 1 ? '' : 's'}` : null,
    item.turnCount ? `${item.turnCount} turn${item.turnCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')
}

function urgencyOfWork(item: WorkItem): Urgency {
  switch (item.status) {
    case 'needs-you':
      return 'needs-you'
    case 'running':
      return 'working'
    case 'failed':
      return 'broken'
    case 'yours':
      return 'ready'
    default:
      return 'quiet'
  }
}

function toneOfWork(item: WorkItem): Tone {
  switch (item.status) {
    case 'needs-you':
      return 'yellow'
    case 'running':
      return 'cyan'
    case 'failed':
      return 'red'
    case 'yours':
      return 'cyan'
    default:
      return 'green'
  }
}

function fromPulls(pulls: RailInput['pulls']): RailItem[] {
  if (!pulls) return []

  return [...pulls.reviewing, ...pulls.mine].map(pull => ({
    key: `pull:${pull.number}`,
    kind: 'pull' as const,
    id: String(pull.number),
    title: `#${pull.number}  ${pull.title}`,
    detail: [
      pull.mine ? 'yours' : pull.author,
      pull.changedFiles ? `${pull.changedFiles} files  +${pull.additions}/−${pull.deletions}` : null,
      pull.checks === 'none' ? null : `checks ${pull.checks}`,
      pull.draft ? 'draft' : null,
    ].filter(Boolean).join(' · '),
    status: pull.verdict.label,
    urgency: pull.verdict.onYou
      ? 'needs-you' as const
      : pull.checks === 'failing'
        ? 'broken' as const
        : pull.verdict.state === 'ready' ? 'ready' as const : 'quiet' as const,
    tone: pull.verdict.onYou ? 'yellow' as const : pull.checks === 'failing' ? 'red' as const : 'gray' as const,
    at: pull.updatedAt,
    repo: pull.mine ? undefined : pull.author,
    browserPath: pull.url,
  }))
}

function fromRituals(schedules: Schedule[], histories: Record<string, RitualHistory>): RailItem[] {
  return schedules.map((schedule) => {
    const streak = histories[schedule.id]?.failingStreak ?? 0
    const broken = streak >= 2 || Boolean(schedule.pausedReason)

    return {
      key: `ritual:${schedule.id}`,
      kind: 'ritual' as const,
      id: schedule.id,
      title: schedule.title,
      // The age goes in the row's own trailing column, which is why it is not
      // spelled out here: two answers to "when" on one line is one too many.
      detail: schedule.description,
      status: schedule.pausedReason
        ? 'Paused'
        : !schedule.enabled
            ? 'Disabled'
            : streak >= 2 ? `${streak} failed` : 'On',
      urgency: broken ? 'broken' as const : 'quiet' as const,
      tone: broken ? 'yellow' as const : schedule.enabled ? 'green' as const : 'gray' as const,
      at: schedule.lastRunAt ?? schedule.createdAt,
      stamp: schedule.lastRunAt,
    }
  })
}

function fromInbox(sources: InboxSource[]): RailItem[] {
  const items: RailItem[] = []

  for (const source of sources) {
    if (source.error) {
      items.push({
        key: `inbox:${source.key}`,
        kind: 'inbox',
        id: source.key,
        title: source.label,
        detail: source.error,
        status: source.label,
        urgency: 'broken',
        tone: 'red',
        at: source.checkedAt ?? 0,
      })
      continue
    }

    for (const item of source.items) {
      items.push({
        key: `inbox:${source.key}:${item.id}`,
        kind: 'inbox',
        id: item.id,
        title: item.title,
        detail: item.why,
        status: source.label,
        /**
         * Waiting, not needing: these are real, but a Slack thread does not
         * block an agent, and seven of them at the top of the rail would bury
         * the one prompt that does.
         */
        urgency: 'waiting',
        tone: 'cyan',
        at: source.checkedAt ?? 0,
        repo: source.key,
        browserPath: item.url,
      })
    }
  }

  return items
}

function fromProjects(
  projects: Project[],
  activeProject: string | null,
  scope: string | null,
  home: string,
): RailItem[] {
  return projects.map(project => ({
    key: `project:${project.path}`,
    kind: 'project' as const,
    id: project.path,
    title: project.name || short(project.path, home),
    detail: `${short(project.path, home)} · ${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`,
    status: !project.exists
      ? 'Missing'
      : project.path === scope
          ? (project.path === activeProject ? 'Here' : 'Here only')
          : project.path === activeProject ? 'App default' : 'Saved',
    urgency: 'quiet' as const,
    tone: !project.exists ? 'red' as const : project.path === scope ? 'cyan' as const : 'gray' as const,
    at: 0,
  }))
}

function short(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

export function onFilter(items: RailItem[], filter: RailFilter): RailItem[] {
  if (filter === 'all') return items
  if (filter === 'needs-you') {
    return items.filter(item => item.urgency === 'needs-you' || item.urgency === 'broken')
  }
  // A run belongs with the sessions: it is the same work seen from the other end.
  if (filter === 'session') return items.filter(item => item.kind === 'session' || item.kind === 'run')
  return items.filter(item => item.kind === filter)
}

export function railCounts(items: RailItem[]): Record<RailFilter, number> {
  const counts = {
    all: items.length,
    'needs-you': 0,
    session: 0,
    run: 0,
    pull: 0,
    ritual: 0,
    inbox: 0,
    project: 0,
  } as Record<RailFilter, number>

  for (const item of items) {
    if (item.urgency === 'needs-you' || item.urgency === 'broken') counts['needs-you'] += 1
    const kind: RailFilter = item.kind === 'run' ? 'session' : item.kind
    counts[kind] += 1
  }

  return counts
}

/** How many rows have said something since they were last looked at. */
export function unreadOf(items: RailItem[], seen: Record<string, number>): RailItem[] {
  return items.filter(item => item.stamp != null && item.stamp > (seen[item.key] ?? 0))
}
