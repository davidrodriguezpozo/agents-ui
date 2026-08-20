import { buildWorkList, onTab, type WorkItem } from '~/utils/workList'
import { countUrgency, isCurrent, moneyLabel, orderTiles, untilLabel, urgencyOf } from '~/utils/wall'
import { formatCost, formatDuration } from '~/utils/time'
import { describeToolCall } from '~/utils/toolCalls'
import type { Api } from './api'
import type { Invocation } from './args'
import { gitRoot, scopeFor } from './cwd'
import { compactAge, pad } from './format'
import { notificationLine, watchNotifications } from './notify'

/**
 * The answers you can get without opening anything.
 *
 * A terminal has one thing a browser does not: other programs. Every list in
 * this app is already an HTTP endpoint, so printing one costs a few lines and
 * makes the whole app scriptable — `agents-studio work --json | jq`, a prompt
 * segment that shows what is blocked, a shell `if` in a git hook.
 *
 * No colour and no cursor tricks: this output is as likely to be read by `grep`
 * as by a person, and a pipe should not have to strip escape codes. Exit status
 * carries the one bit worth branching on, which is whether anything wants you.
 */

/** How many rows a list prints before it says how many it left out. */
const MOST = 12

/** 0 fine · 1 something went wrong · 2 something is waiting on you. */
export type ExitCode = 0 | 1 | 2

export const NEEDS_YOU: ExitCode = 2

export interface Printer {
  out: (line: string) => void
  err: (line: string) => void
}

/**
 * Point the client at a project before anything asks for a list.
 *
 * Every scoped endpoint reads `x-project-dir`, so this is the whole of it: one
 * header, set once, and nothing persisted — a command should not change what
 * the app or the browser considers its active project.
 */
export async function scopeInvocation(api: Api, invocation: Invocation): Promise<string | null> {
  if (invocation.project) {
    api.client.projectDirValue = invocation.project
    return invocation.project
  }

  const here = gitRoot()
  const projects = await api.projects()
  const scope = scopeFor({
    here,
    known: projects.projects.map(project => project.path),
    fallback: projects.activePath,
  })

  api.client.projectDirValue = scope
  return scope
}

export async function runCommand(
  api: Api,
  invocation: Invocation,
  print: Printer,
): Promise<ExitCode> {
  switch (invocation.command) {
    case 'work':
      return work(api, invocation, print)
    case 'land':
      return land(api, invocation, print)
    case 'daily':
      return daily(api, invocation, print)
    case 'fleet':
      return fleet(api, invocation, print)
    case 'inbox':
      return inbox(api, invocation, print)
    case 'new':
      return start(api, invocation, print)
    case 'watch':
      return watch(api, print)
    default:
      print.err(`Nothing to do for ${invocation.command}.`)
      return 1
  }
}

async function work(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const [sessions, runs, attention] = await Promise.all([
    api.sessions(),
    api.runs({ limit: 40 }),
    api.attention(),
  ])

  const here = sessions.filter(session => session.inCurrentProject)
  const items = onTab(buildWorkList({ sessions: here as never, runs: runs as never }), 'flight')

  if (invocation.json) {
    print.out(JSON.stringify({ attention, items }, null, 2))
    return attention.needsYou ? NEEDS_YOU : 0
  }

  if (!invocation.quiet) {
    if (items.length === 0) print.out('Nothing in flight here.')
    for (const item of items.slice(0, MOST)) print.out(workLine(item))
    // Said rather than silently dropped: a list that stops at twelve without
    // mentioning it reads as a list of twelve.
    if (items.length > MOST) print.out(`   … and ${items.length - MOST} more — agents-studio tui`)

    /*
     * The list is this project; the counts are every project, because
     * `/api/attention` is what the app's own badge reads and being blocked in
     * another checkout is still being blocked. Saying which is which is
     * cheaper than picking one and being wrong half the time.
     */
    const everywhere = [
      attention.needsYou ? `${attention.needsYou} need you` : null,
      attention.working ? `${attention.working} working` : null,
      attention.failingRituals ? `${attention.failingRituals} ritual failing` : null,
    ].filter(Boolean).join(' · ')
    if (everywhere) print.out(`\n${everywhere}  (every project)`)
  }

  return attention.needsYou ? NEEDS_YOU : 0
}

function workLine(item: WorkItem): string {
  const detail = [
    item.detail,
    item.changedFiles ? `${item.changedFiles} files` : null,
    formatCost(item.costUsd),
    formatDuration(item.durationMs),
  ].filter(Boolean).join(' · ')

  return [
    pad(mark(item.status), 2),
    pad(item.outcome, 18),
    pad(item.title, 44),
    pad(compactAge(item.at), 6, 'right'),
    detail ? `  ${detail}` : '',
  ].join(' ')
}

function mark(status: string): string {
  switch (status) {
    case 'needs-you':
      return '●'
    case 'running':
      return '◐'
    case 'failed':
      return '✕'
    case 'done':
      return '✓'
    default:
      return '·'
  }
}

async function land(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const reading = await api.pulls()

  if (invocation.json) {
    print.out(JSON.stringify(reading, null, 2))
    return reading.summary.onYou ? NEEDS_YOU : 0
  }

  if (!reading.ok) {
    print.err(reading.reason || 'Could not read pull requests.')
    return 1
  }

  if (!invocation.quiet) {
    const groups: [string, typeof reading.reviewing][] = [
      ['Asked of you', reading.reviewing],
      ['Yours', reading.mine],
    ]
    for (const [title, pulls] of groups) {
      if (pulls.length === 0) continue
      print.out(`${title}  ${pulls.length}`)
      for (const pull of pulls) {
        print.out([
          `  ${pad(`#${pull.number}`, 7)}`,
          pad(pull.title, 44),
          pad(pull.verdict.label, 18),
          `checks ${pull.checks}`,
        ].join(' '))
      }
    }
    if (reading.reviewing.length + reading.mine.length === 0) print.out('No pull requests with your name on them.')
  }

  return reading.summary.onYou ? NEEDS_YOU : 0
}

async function daily(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const [schedules, histories] = await Promise.all([api.schedules(), api.scheduleHistory()])
  const failing = schedules.filter(schedule => (histories[schedule.id]?.failingStreak ?? 0) >= 2)

  if (invocation.json) {
    print.out(JSON.stringify({ schedules, histories }, null, 2))
    return failing.length ? NEEDS_YOU : 0
  }

  if (!invocation.quiet) {
    if (schedules.length === 0) print.out('No rituals.')
    for (const schedule of schedules) {
      const history = histories[schedule.id]
      const streak = history?.failingStreak ?? 0
      const state = schedule.pausedReason
        ? 'paused'
        : !schedule.enabled
            ? 'off'
            : streak >= 2 ? `${streak} failed` : 'on'
      const next = schedule.nextRunAt ? untilLabel(schedule.nextRunAt, Date.now()) : '—'
      const last = schedule.lastRunAt ? `ran ${compactAge(schedule.lastRunAt)}` : 'never ran'
      print.out([
        pad(state, 10),
        pad(schedule.title, 32),
        pad(schedule.description, 26),
        pad(next, 8),
        last,
      ].join(' '))
    }
  }

  return failing.length ? NEEDS_YOU : 0
}

async function fleet(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const snapshot = await api.wall()
  const tiles = orderTiles(snapshot.tiles.filter(tile => isCurrent(tile, snapshot.at)))
  const counts = countUrgency(tiles)

  if (invocation.json) {
    print.out(JSON.stringify(snapshot, null, 2))
    return counts['needs-you'] ? NEEDS_YOU : 0
  }

  if (!invocation.quiet) {
    print.out([
      `${counts['needs-you']} need you`,
      `${counts.working} working`,
      `${counts.broken} broken`,
      `${moneyLabel(snapshot.spend.todayUsd)} today`,
    ].join('    '))

    for (const tile of tiles.slice(0, MOST)) {
      const doing = tile.prompts[0]
        ? `wants to ${describeToolCall({ toolName: tile.prompts[0]!.toolName, input: tile.prompts[0]!.input }).verb}`
        : tile.doing
          ? describeToolCall({ toolName: tile.doing.toolName, input: tile.doing.input }).verb
          : tile.branch
      print.out([
        pad(tileMark(tile), 2),
        pad(tile.title, 40),
        pad(tile.repo, 16),
        doing,
      ].join(' '))
    }
    if (tiles.length > MOST) print.out(`   … and ${tiles.length - MOST} more`)

    for (const ritual of snapshot.upcoming.slice(0, 3)) {
      print.out(`   next  ${pad(untilLabel(ritual.at, Date.now()), 8)}${ritual.title}`)
    }
  }

  return counts['needs-you'] ? NEEDS_YOU : 0
}

/** The same glyphs the app uses, decided by urgency rather than by activity. */
function tileMark(tile: { activity: string; prompts: unknown[]; check?: { status: string } | null }): string {
  const urgency = urgencyOf(tile as never)
  switch (urgency) {
    case 'needs-you':
      return '●'
    case 'working':
      return '◐'
    case 'broken':
      return '✕'
    default:
      return '·'
  }
}

async function inbox(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const { sources } = await api.inbox()
  const waiting = sources.reduce((total, source) => total + source.items.length, 0)

  if (invocation.json) {
    print.out(JSON.stringify({ sources }, null, 2))
    return waiting ? NEEDS_YOU : 0
  }

  if (!invocation.quiet) {
    if (waiting === 0) print.out('Nothing waiting elsewhere.')
    for (const source of sources) {
      for (const item of source.items) {
        print.out([pad(source.label, 12), pad(item.title, 46), item.why].join(' '))
      }
      if (source.error) print.err(`${pad(source.label, 12)}${source.error}`)
    }
  }

  return waiting ? NEEDS_YOU : 0
}

async function start(api: Api, invocation: Invocation, print: Printer): Promise<ExitCode> {
  const repoDir = await scopeInvocation(api, invocation) ?? undefined
  if (!repoDir) {
    print.err('No project. Run this inside one, pass --project DIR, or pick one in the app.')
    return 1
  }

  const session = await api.startSession({ prompt: invocation.prompt!, repoDir })

  if (invocation.json) {
    print.out(JSON.stringify(session, null, 2))
  } else {
    print.out(`Started ${session.id}`)
    if (session.startError) print.err(session.startError)
    else print.out(`Watch it with  agents-studio tui ${session.id}`)
  }

  return session.startError ? 1 : 0
}

/**
 * Follow what happens, until you stop it.
 *
 * The same stream the app listens to, one line each — which makes it something
 * you can leave in a split, or pipe into anything that reacts to lines.
 */
async function watch(api: Api, print: Printer): Promise<ExitCode> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  print.out('Watching. Ctrl-C to stop.')
  await watchNotifications(api.client, {
    signal: controller.signal,
    onNotification: notification => print.out(notificationLine(notification)),
  })

  return 0
}
