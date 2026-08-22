import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { getClaudeDir, OUR_DIR } from './claudeDir'
import type { OutcomeSession, OutcomeTurn } from './outcomes'

/**
 * What this machine did, in a form another machine can read.
 *
 * Everything else here answers for one laptop. `outcomes.ts` joins runs to
 * landings, `ledger.ts` pairs two windows of that, and both stop at the edge of
 * the disk they run on — so a team of three has three ledgers, each of them
 * honest and none of them the total. The question "what did we ship this week,
 * and what did it cost" had no owner, and the obvious way to give it one is a
 * server with everybody's data in it, which is the thing this app is built not
 * to be.
 *
 * So: one file per instance, append-only, one line per outcome, and git as the
 * transport. That choice decides the awkward cases before they happen. Two
 * machines never write the same file, so a merge is a concatenation and there
 * is nothing to resolve. An instance that is offline for a week is not a
 * failure state — it appends locally and pushes when it can. Nothing is
 * central, so nothing has to be running for a colleague's numbers to be
 * readable, and there is no account, no schema migration and no server to
 * outlive the team.
 *
 * Four decisions worth naming:
 *
 *   - **Append-only, and a line is never rewritten.** Not for purity: a rewrite
 *     is what turns a concatenation merge back into a conflict. The cost is that
 *     a wrong line stays wrong, which is why so little is written — see below.
 *   - **Ids, numbers, routes and timestamps. No prose.** Not a style rule. These
 *     lines are written by one machine, pushed to a branch, and read into a page
 *     on somebody else's, so a session title is text a colleague wrote arriving
 *     in your browser. The serialiser here takes named fields and nothing else,
 *     so a title cannot reach a line by being added to a record upstream.
 *   - **Every line carries the format version it was written with.** A colleague
 *     who has updated first will push lines this code has never seen, and the
 *     honest answer to those is to count them and say so, rather than to guess
 *     at them or to refuse the whole file.
 *   - **A machine is a machine, not a person.** The id is per instance, because
 *     the file is per instance: two checkouts on one laptop pointed at different
 *     `CLAUDE_DIR`s are two writers and must not share a filename. Who did the
 *     work is a separate field, and it is `personKey` — an address, already the
 *     key every other total groups by.
 *
 * `ledgerSync.ts` is the push and pull. This file is the format, the append and
 * the totals, and it knows nothing about git.
 */

/**
 * The format version stamped on every line written here.
 *
 * Bumped when a line gains a field a reader has to understand to add it up
 * correctly. A reader that meets a higher number counts the line as unreadable
 * and reports it — see `readLedgerText`.
 */
export const LEDGER_FORMAT = 1

/** Where the local file and its siblings live, under the store. */
export const LEDGER_DIR = 'ledger'

/** Holds this instance's id, so it stays the same file across restarts. */
const MACHINE_FILE = 'machine'

export type LedgerEvent = 'turn' | 'landing' | 'revert' | 'check'

/** How the work got in, mirroring `LandedHow`. */
export type LedgerLanding = 'merged' | 'pull-request' | 'elsewhere'

/** What the checks said, and only the two verdicts that are about the code. */
export type LedgerVerdict = 'passing' | 'failing'

/**
 * One outcome, as a line.
 *
 * Flat and short on purpose: every field here is something a total is grouped
 * by or added up, and anything else would be data crossing a machine boundary
 * for no reader.
 */
export interface LedgerEntry {
  /** The format this line was written with. */
  v: number
  /**
   * Unique within the file that holds it, and what makes a second append a
   * no-op. Prefixed by event, so a session's landing and its revert are two
   * lines rather than one overwriting the other.
   */
  id: string
  event: LedgerEvent
  at: number
  costUsd?: number
  /** `personKey` — an address, never a display name. Absent means unattributed. */
  person?: string
  /** The session this is about, when one owns it. */
  sessionId?: string
  /** The ritual that fired it, when one did. */
  scheduleId?: string
  landing?: LedgerLanding
  verdict?: LedgerVerdict
  /** That the landing went in over a failing check. */
  override?: true
}

export interface LedgerTotals {
  turns: number
  costUsd: number
  landings: number
  /** Landings whose work has since been taken back out. A subset of `landings`. */
  reverts: number
  checks: { passing: number; failing: number }
}

/** One file, read. */
export interface LedgerMachineReport {
  machine: string
  entries: number
  /** The newest timestamp in the file, or absent for an empty one. */
  lastAt?: number
  /** Lines that could not be read at all. */
  corrupt: number
  /** Lines from a newer format than this reader understands. */
  newer: number
  totals: LedgerTotals
}

export interface LedgerPersonReport {
  /** `personKey`. Only people who are named appear here. */
  person: string
  totals: LedgerTotals
}

export interface LedgerTeamReport {
  totals: LedgerTotals
  /** One per file present, freshest first. */
  machines: LedgerMachineReport[]
  /** Named people only, most spent first. */
  people: LedgerPersonReport[]
  /**
   * Spend on lines that name nobody — rituals, and anything written before
   * identity existed. Kept out of `people` rather than pooled into a row,
   * because a row called "unattributed" in a table of colleagues reads like a
   * person with a strange name and a large bill.
   */
  unattributedCostUsd: number
}

// --- The line ---------------------------------------------------------------

/**
 * One entry, as the text of a line.
 *
 * Field by field rather than `JSON.stringify(entry)`: the point is that only
 * these fields can ever be written, whatever a caller hands over. A stable key
 * order costs nothing and makes two runs over the same outcome produce the same
 * bytes, which is what lets a diff of this branch be read by eye.
 */
export function ledgerLine(entry: LedgerEntry): string {
  const line: Record<string, unknown> = { v: entry.v, at: entry.at, event: entry.event, id: entry.id }

  if (typeof entry.costUsd === 'number' && Number.isFinite(entry.costUsd)) line.costUsd = round(entry.costUsd)
  if (entry.person) line.person = entry.person
  if (entry.sessionId) line.sessionId = entry.sessionId
  if (entry.scheduleId) line.scheduleId = entry.scheduleId
  if (entry.landing) line.landing = entry.landing
  if (entry.verdict) line.verdict = entry.verdict
  if (entry.override) line.override = true

  return JSON.stringify(line)
}

/** Cents are the smallest thing anybody reads off these, and floats accumulate. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/** Why a line was not counted. */
export type LedgerSkip = 'corrupt' | 'newer'

export function parseLedgerLine(text: string): { entry: LedgerEntry } | { skip: LedgerSkip } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { skip: 'corrupt' }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { skip: 'corrupt' }
  const line = raw as Record<string, unknown>

  const v = line.v
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1) return { skip: 'corrupt' }
  // Not corrupt: a colleague on a newer version wrote it, and it is perfectly
  // good — this reader is the one that is behind.
  if (v > LEDGER_FORMAT) return { skip: 'newer' }

  const id = line.id
  const at = line.at
  const event = line.event
  if (typeof id !== 'string' || !id) return { skip: 'corrupt' }
  if (typeof at !== 'number' || !Number.isFinite(at)) return { skip: 'corrupt' }
  if (event !== 'turn' && event !== 'landing' && event !== 'revert' && event !== 'check') {
    return { skip: 'corrupt' }
  }

  const entry: LedgerEntry = { v, id, at, event }

  // A cost that is present and not a number is a corrupt line rather than a
  // line with the cost dropped: a total quietly missing a turn is worse than a
  // line that is counted as unreadable and said out loud.
  if (line.costUsd !== undefined) {
    if (typeof line.costUsd !== 'number' || !Number.isFinite(line.costUsd) || line.costUsd < 0) {
      return { skip: 'corrupt' }
    }
    entry.costUsd = line.costUsd
  }

  if (typeof line.person === 'string' && line.person) entry.person = line.person
  if (typeof line.sessionId === 'string' && line.sessionId) entry.sessionId = line.sessionId
  if (typeof line.scheduleId === 'string' && line.scheduleId) entry.scheduleId = line.scheduleId
  if (line.landing === 'merged' || line.landing === 'pull-request' || line.landing === 'elsewhere') {
    entry.landing = line.landing
  }
  if (line.verdict === 'passing' || line.verdict === 'failing') entry.verdict = line.verdict
  if (line.override === true) entry.override = true

  return { entry }
}

export interface LedgerRead {
  entries: LedgerEntry[]
  corrupt: number
  newer: number
}

/**
 * A whole file, read.
 *
 * Blank lines are not skips: a file that ends in a newline, which every file
 * written here does, would otherwise report one corrupt line forever.
 */
export function readLedgerText(text: string): LedgerRead {
  const read: LedgerRead = { entries: [], corrupt: 0, newer: 0 }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue

    const result = parseLedgerLine(line)
    if ('entry' in result) read.entries.push(result.entry)
    else if (result.skip === 'newer') read.newer++
    else read.corrupt++
  }

  return read
}

// --- Appending --------------------------------------------------------------

/**
 * The text to write, given what is already there.
 *
 * Idempotent on the entry id, and that is the whole reason ids are shaped the
 * way they are. Nothing here knows how often it is called: the collector runs
 * on a timer, on a page load, and again when somebody presses sync, and each
 * of those may cover a window it has already covered. An id already in the
 * file is skipped, and so is a repeat inside one batch.
 *
 * Existing lines are copied through untouched — including the ones this reader
 * cannot make sense of, which belong to whoever wrote them.
 */
export function appendLedgerText(
  existing: string,
  entries: LedgerEntry[],
): { text: string; added: number; skipped: number } {
  const known = new Set<string>()
  for (const line of existing.split('\n')) {
    if (!line.trim()) continue
    const result = parseLedgerLine(line)
    if ('entry' in result) known.add(result.entry.id)
  }

  const fresh: string[] = []
  let skipped = 0

  for (const entry of entries) {
    if (known.has(entry.id)) {
      skipped++
      continue
    }
    known.add(entry.id)
    fresh.push(ledgerLine(entry))
  }

  if (!fresh.length) return { text: existing, added: 0, skipped }

  const head = existing && !existing.endsWith('\n') ? `${existing}\n` : existing

  return { text: `${head}${fresh.join('\n')}\n`, added: fresh.length, skipped }
}

// --- What this machine has to say -------------------------------------------

/**
 * The lines an outcome window comes to.
 *
 * One turn is one line, and a session contributes up to three — it landed, the
 * landing was taken back out, the checks reached a verdict. Each is keyed on
 * the record it describes, so running this over an overlapping window produces
 * the same ids and appends nothing.
 *
 * A session's own id is in the line, which is an id and not prose. Its title,
 * its branch and its repository path are not: a path names a directory on
 * somebody's disk and would be the one field here that says something about a
 * machine rather than about work.
 */
export function ledgerEntriesOf(input: { turns: OutcomeTurn[]; sessions: OutcomeSession[] }): LedgerEntry[] {
  const entries: LedgerEntry[] = []

  for (const turn of input.turns) {
    entries.push({
      v: LEDGER_FORMAT,
      id: `turn:${turn.id}`,
      event: 'turn',
      at: turn.startedAt ?? turn.createdAt,
      ...(typeof turn.costUsd === 'number' ? { costUsd: turn.costUsd } : {}),
      ...(turn.person ? { person: turn.person } : {}),
      ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
      ...(turn.scheduleId ? { scheduleId: turn.scheduleId } : {}),
    })
  }

  for (const session of input.sessions) {
    const landed = session.landed
    if (landed) {
      entries.push({
        v: LEDGER_FORMAT,
        id: `landing:${session.id}`,
        event: 'landing',
        at: landed.at,
        landing: landed.how,
        ...(personOf(landed.by) ? { person: personOf(landed.by)! } : {}),
        sessionId: session.id,
        ...(landed.overrodeChecks ? { override: true as const } : {}),
      })
    }

    const reverted = session.reverted
    if (reverted) {
      entries.push({
        v: LEDGER_FORMAT,
        id: `revert:${session.id}`,
        event: 'revert',
        // When the work went back out, not when this machine noticed.
        at: reverted.committedAt || reverted.at,
        sessionId: session.id,
      })
    }

    const check = session.check
    // Only a verdict about the code. `running` is not one yet, and `errored`
    // says the check could not run, which is a fact about a machine.
    if (check && (check.status === 'passing' || check.status === 'failing')) {
      entries.push({
        v: LEDGER_FORMAT,
        id: `check:${session.id}:${check.fingerprint || check.at}`,
        event: 'check',
        at: check.at,
        verdict: check.status,
        sessionId: session.id,
      })
    }
  }

  return entries
}

/** The key, never the name: `describePerson` is prose and prose does not travel. */
function personOf(identity?: { name?: string; email?: string }): string | undefined {
  const email = identity?.email?.trim().toLowerCase()
  if (email) return email

  return identity?.name?.trim() || undefined
}

// --- Adding it up -----------------------------------------------------------

function emptyTotals(): LedgerTotals {
  return { turns: 0, costUsd: 0, landings: 0, reverts: 0, checks: { passing: 0, failing: 0 } }
}

function count(totals: LedgerTotals, entry: LedgerEntry): void {
  if (entry.event === 'turn') {
    totals.turns++
    totals.costUsd = round(totals.costUsd + (entry.costUsd ?? 0))
    return
  }
  if (entry.event === 'landing') {
    totals.landings++
    return
  }
  if (entry.event === 'revert') {
    totals.reverts++
    return
  }
  if (entry.verdict === 'passing') totals.checks.passing++
  else if (entry.verdict === 'failing') totals.checks.failing++
}

export interface LedgerFile {
  machine: string
  text: string
}

/**
 * Every file present, as one report.
 *
 * A missing machine is a missing machine: nothing here fills a gap in, and
 * `lastAt` per file is what a page says instead of averaging over one. The
 * files are not deduplicated against each other — every id in them is minted by
 * the instance that owns the file, so two of them cannot describe the same
 * outcome, and pretending to resolve a collision that cannot happen would only
 * hide the one case where it did: a store copied from one machine to another.
 */
export function teamLedger(files: LedgerFile[], since = 0): LedgerTeamReport {
  const totals = emptyTotals()
  const machines: LedgerMachineReport[] = []
  const people = new Map<string, LedgerTotals>()
  let unattributedCostUsd = 0

  for (const file of files) {
    const read = readLedgerText(file.text)
    const report: LedgerMachineReport = {
      machine: file.machine,
      entries: 0,
      corrupt: read.corrupt,
      newer: read.newer,
      totals: emptyTotals(),
    }

    for (const entry of read.entries) {
      if (entry.at < since) continue

      report.entries++
      report.lastAt = Math.max(report.lastAt ?? 0, entry.at)
      count(report.totals, entry)
      count(totals, entry)

      if (entry.person) {
        const held = people.get(entry.person) ?? emptyTotals()
        count(held, entry)
        people.set(entry.person, held)
      } else if (entry.event === 'turn') {
        unattributedCostUsd = round(unattributedCostUsd + (entry.costUsd ?? 0))
      }
    }

    machines.push(report)
  }

  machines.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.machine.localeCompare(b.machine))

  const ranked = [...people.entries()]
    .map(([person, held]) => ({ person, totals: held }))
    .sort((a, b) => b.totals.costUsd - a.totals.costUsd || a.person.localeCompare(b.person))

  return { totals, machines, people: ranked, unattributedCostUsd }
}

// --- The files themselves ---------------------------------------------------

/**
 * A filename this machine owns.
 *
 * Slugged rather than trusted: a hostname can contain anything the person who
 * set it liked, and this ends up as a path and as a label on a page. The
 * suffix is what makes it *this instance* — see the note at the top about two
 * checkouts on one laptop.
 */
export function machineSlug(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)

  return slug || 'machine'
}

/** Beside every other thing this app stores, never at the top of `~/.claude`. */
export function ledgerDir(): string {
  return join(getClaudeDir(), OUR_DIR, LEDGER_DIR)
}

/**
 * This instance's id, made once and then read.
 *
 * Written to its own file rather than derived from the store path, because a
 * store that gets moved is still the same instance and must keep appending to
 * the same file — a new id there would leave the old file orphaned and count
 * its turns forever without ever adding to them.
 */
export async function machineId(): Promise<string> {
  const dir = ledgerDir()
  const path = join(dir, MACHINE_FILE)

  try {
    const held = (await readFile(path, 'utf8')).trim()
    if (held) return held
  } catch {
    // Not made yet, which is the normal case exactly once.
  }

  const id = `${machineSlug(hostname())}-${randomBytes(3).toString('hex')}`
  await mkdir(dir, { recursive: true })
  await writeFile(path, `${id}\n`, 'utf8')

  return id
}

export function ledgerFileName(machine: string): string {
  return `${machineSlug(machine)}.jsonl`
}

/** Every ledger file in the store, this machine's included. */
export async function readLedgerFiles(): Promise<LedgerFile[]> {
  const dir = ledgerDir()

  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const files: LedgerFile[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.jsonl')) continue

    try {
      files.push({ machine: name.slice(0, -'.jsonl'.length), text: await readFile(join(dir, name), 'utf8') })
    } catch {
      // A file that cannot be read is a machine that is not reported, which is
      // the same thing as a machine that has not pushed yet.
    }
  }

  return files
}

/**
 * Append to this machine's own file, and to no other.
 *
 * Read-modify-write rather than an `appendFile`, because the answer to "is this
 * already in there" is in the file. One instance owns this file, so nothing
 * else is writing it while this runs.
 */
export async function appendLocalLedger(entries: LedgerEntry[]): Promise<{ added: number; skipped: number }> {
  if (!entries.length) return { added: 0, skipped: 0 }

  const dir = ledgerDir()
  const machine = await machineId()
  const path = join(dir, ledgerFileName(machine))

  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch {
    // First append.
  }

  const { text, added, skipped } = appendLedgerText(existing, entries)
  if (added) {
    await mkdir(dir, { recursive: true })
    await writeFile(path, text, 'utf8')
  }

  return { added, skipped }
}
