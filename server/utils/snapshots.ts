import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { computeNextRun, readSchedules, writeSchedules, type Schedule } from './schedules'
import { readSessions, writeSessions, type Session } from './sessions'

/**
 * Point-in-time copies of the state that cannot be rebuilt from anywhere else.
 *
 * A session can be reconstructed from its worktree, its branch and its
 * transcript. A daily ritual cannot — nothing else on the machine remembers
 * that someone wanted a briefing at 08:00 on weekdays. So rituals are the real
 * reason this exists, and sessions come along because they are small.
 *
 * Snapshots live *beside* the app's directory rather than inside it, because
 * the failure this guards against is that whole directory going away. A backup
 * stored within what it is backing up is not a backup.
 *
 * Run history is deliberately not included: each run is already its own file,
 * so damage costs one run rather than all of them, and copying full transcripts
 * every half hour would trade a real problem for a disk-space one.
 */

const KEEP = 20

export type SnapshotReason = 'auto' | 'manual' | 'pre-restore' | 'startup'

export interface SnapshotFile {
  version: number
  createdAt: number
  reason: SnapshotReason
  sessions: Session[]
  schedules: Schedule[]
}

export interface SnapshotInfo {
  name: string
  createdAt: number
  reason: SnapshotReason
  sessions: number
  schedules: number
  bytes: number
}

export function snapshotsDir(): string {
  return join(getClaudeDir(), 'agents-ui-backups')
}

/** Sortable, readable, and safe as a filename on every platform. */
function stamp(at: number): string {
  return new Date(at).toISOString().replace(/[:.]/g, '-').replace('Z', '')
}

export async function listSnapshots(): Promise<SnapshotInfo[]> {
  const dir = snapshotsDir()
  if (!existsSync(dir)) return []

  const files = (await readdir(dir).catch(() => [] as string[]))
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))

  const infos = await Promise.all(files.map(async (name) => {
    const raw = await readFile(join(dir, name), 'utf-8').catch(() => '')
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as SnapshotFile
      return {
        name,
        createdAt: parsed.createdAt,
        reason: parsed.reason,
        sessions: parsed.sessions?.length ?? 0,
        schedules: parsed.schedules?.length ?? 0,
        bytes: Buffer.byteLength(raw),
      }
    } catch {
      return null
    }
  }))

  return infos
    .filter((info): info is SnapshotInfo => info !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Newest first, so index 0 is the most recent — used for the identical check. */
async function readSnapshot(name: string): Promise<SnapshotFile> {
  const path = join(snapshotsDir(), name)
  if (!existsSync(path)) {
    throw createError({ statusCode: 404, message: `No snapshot named ${name}` })
  }
  return JSON.parse(await readFile(path, 'utf-8')) as SnapshotFile
}

/** What actually matters for "has anything changed since the last one". */
function fingerprint(snapshot: Pick<SnapshotFile, 'sessions' | 'schedules'>): string {
  return JSON.stringify({ s: snapshot.sessions, r: snapshot.schedules })
}

export interface SnapshotResult {
  created: boolean
  name?: string
  /** Set when an automatic snapshot was skipped because nothing had changed. */
  reason?: string
}

export async function createSnapshot(reason: SnapshotReason = 'manual'): Promise<SnapshotResult> {
  // If either store is unreadable, take nothing. Writing a snapshot of a
  // damaged state would rotate a good one out of the window — turning a
  // recoverable problem into a permanent one.
  const [sessions, schedules] = await Promise.all([readSessions(), readSchedules()])

  const existing = await listSnapshots()
  if (reason === 'auto' || reason === 'startup') {
    const newest = existing[0]
    if (newest) {
      const previous = await readSnapshot(newest.name).catch(() => null)
      if (previous && fingerprint(previous) === fingerprint({ sessions, schedules })) {
        return { created: false, reason: 'Nothing has changed since the last snapshot.' }
      }
    }
  }

  const createdAt = Date.now()
  const payload: SnapshotFile = { version: 1, createdAt, reason, sessions, schedules }
  const name = `snapshot-${stamp(createdAt)}-${reason}.json`

  const dir = snapshotsDir()
  await mkdir(dir, { recursive: true })

  const target = join(dir, name)
  const tmp = `${target}.tmp`
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  await rename(tmp, target)

  // Rotate oldest-out, counting the one just written.
  for (const old of [...existing, { name, createdAt } as SnapshotInfo]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(KEEP)) {
    await rm(join(dir, old.name), { force: true }).catch(() => {})
  }

  return { created: true, name }
}

export interface RestoreResult {
  restored: { sessions: number; schedules: number }
  /** The state as it was before restoring, kept so this can be undone. */
  safetySnapshot?: string
  from: { name: string; createdAt: number }
}

/**
 * Replace the current sessions and rituals with a snapshot's.
 *
 * A snapshot of the current state is taken first, so restoring the wrong one is
 * itself undoable — without that, recovery would be a one-way door.
 */
export async function restoreSnapshot(name: string): Promise<RestoreResult> {
  const snapshot = await readSnapshot(name)

  let safetySnapshot: string | undefined
  try {
    const safety = await createSnapshot('pre-restore')
    safetySnapshot = safety.name
  } catch {
    // The current state is unreadable, which is usually *why* someone is
    // restoring. Carry on rather than blocking the recovery.
  }

  await writeSessions(snapshot.sessions ?? [])

  // Recompute when each ritual is next due. A snapshot carries the `nextRunAt`
  // it had when taken, and restoring a stale one would either fire the ritual
  // the moment it lands or leave it looking overdue.
  await writeSchedules((snapshot.schedules ?? []).map(schedule => ({
    ...schedule,
    nextRunAt: computeNextRun(schedule.recurrence),
  })))

  return {
    restored: {
      sessions: snapshot.sessions?.length ?? 0,
      schedules: snapshot.schedules?.length ?? 0,
    },
    safetySnapshot,
    from: { name, createdAt: snapshot.createdAt },
  }
}
