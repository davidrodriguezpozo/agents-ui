import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { runClaude } from './cli'
import { defineJsonStore } from './jsonStore'
import type { LessonCandidate } from './lessons'
import { repositoryRootOf } from './worktrees'

/**
 * Turning a lesson into one line somebody can accept.
 *
 * `lessons.ts` collects what went wrong and stops at a list. This is the other
 * half, and the reason the two are separate files is the reason the whole
 * feature is defensible: collecting is mechanical and can be tested, proposing
 * a *rule* is a judgement and has to be reviewable. What the cloud tools sell as
 * memory that improves silently, this does as a line in a file and a diff.
 *
 * The compounding is real and comes from where the line lands. `CLAUDE.md` is in
 * the repository, so one person accepting a rule improves everybody's agents on
 * the next pull — which only works if it is auditable, which means a file and a
 * diff rather than a store nobody can read.
 *
 * Four rules, and the last one is not negotiable:
 *
 *   - **One candidate, one line, one destination**, and the destination is a
 *     choice made before anything is written.
 *   - **The model only ever sees the structured candidate.** Ids, counts, names,
 *     timestamps — the same fields `lessons.ts` guarantees. No transcript, no
 *     session title, no commit message: nothing that came from outside this
 *     machine reaches the prompt, so nothing outside this machine can influence
 *     the rule it proposes.
 *   - **A rejection is recorded**, so next week's list does not open with the
 *     same suggestion somebody has already considered and declined.
 *   - **It can never write on its own.** There is no setting for it and no code
 *     path that reaches `acceptProposal` without a decision. The moment a thing
 *     like this writes unattended, it is the feature people switch off.
 */

/** Where a proposed line can go. Each is a file a person can read afterwards. */
export type ProposalDestination =
  /** The repository's own instructions to Claude Code — the one that compounds. */
  | 'claude-md'
  /** This machine's note to itself, at the top of every brief. */
  | 'brief'
  /** The shared half of the project's configuration — see `sharedProject.ts`. */
  | 'shared-project'

export interface DestinationInfo {
  destination: ProposalDestination
  label: string
  /** Absolute, so a page can say which file it is about to change. */
  path: string
  exists: boolean
  /** Whether accepting would create the file rather than add a line to it. */
  creates: boolean
  /** What kind of line belongs here, which is also what the model is told. */
  wants: string
}

export function destinationsFor(repoDir: string): DestinationInfo[] {
  const claudeMd = join(repoDir, 'CLAUDE.md')
  const shared = join(repoDir, '.claude', 'agents-studio.json')

  return [
    {
      destination: 'claude-md',
      label: 'CLAUDE.md, in this repository',
      path: claudeMd,
      exists: existsSync(claudeMd),
      creates: !existsSync(claudeMd),
      wants: 'an instruction to whoever works in this repository next, in the imperative',
    },
    {
      destination: 'brief',
      label: 'The standing brief, on this machine',
      path: join(getClaudeDir(), 'agents-ui', 'brief.json'),
      exists: true,
      creates: false,
      wants: 'a note to this machine\'s own runs, which nobody else will read',
    },
    {
      destination: 'shared-project',
      label: 'The project\'s shared configuration',
      path: shared,
      exists: existsSync(shared),
      creates: !existsSync(shared),
      wants: 'a one-line comment recording the decision, for the team to read in review',
    },
  ]
}

// --- What has been decided ---------------------------------------------------

export type LessonVerdict = 'accepted' | 'rejected'

export interface LessonDecision {
  key: string
  verdict: LessonVerdict
  at: number
  /** Where it went, on an acceptance. */
  destination?: ProposalDestination
  /** The line that was written, so the record says what was agreed. */
  line?: string
}

export type LessonDecisions = Record<string, LessonDecision>

/**
 * Kept on this machine rather than in the repository, and deliberately.
 *
 * The *rule* belongs to the team and lands in a tracked file. Whether you have
 * already considered a suggestion is bookkeeping about a list, and putting that
 * in somebody's diff would be this app filing paperwork in a code review.
 */
export const lessonDecisionStore = defineJsonStore<LessonDecisions>({
  label: 'lesson decisions',
  path: () => join(getClaudeDir(), 'agents-ui', 'lesson-decisions.json'),
  empty: () => ({}),
  decode: parsed => parsed?.decisions ?? {},
  encode: decisions => ({ version: 1, decisions }),
})

export async function readLessonDecisions(): Promise<LessonDecisions> {
  try {
    return await lessonDecisionStore.read()
  } catch {
    // An unreadable record means every lesson looks new, which is noisy rather
    // than dangerous — the opposite mistake would hide a real lesson.
    return {}
  }
}

/**
 * The lessons still worth showing: everything nobody has ruled on.
 *
 * Both verdicts remove a lesson from the list, for different reasons. A rejected
 * one was considered and declined, and offering it again weekly is how a list
 * gets ignored. An accepted one already has its rule in a file, and the lesson
 * is what produced the rule rather than something still outstanding.
 */
export function undecidedLessons(
  candidates: LessonCandidate[],
  decisions: LessonDecisions,
): LessonCandidate[] {
  return candidates.filter(candidate => !decisions[candidate.key])
}

// --- Proposing ---------------------------------------------------------------

/** Small and fast: this is one line from six numbers, not an essay. */
const PROPOSAL_MODEL = 'claude-haiku-4-5-20251001'

/** A rule longer than this is a paragraph, and a paragraph is not a rule. */
export const MAX_LINE = 200

/**
 * What the model is given, and the whole of it.
 *
 * Built from the candidate's own fields with `JSON.stringify`, so adding a field
 * to `LessonCandidate` cannot accidentally widen this to something a colleague
 * wrote. Every value in here was produced by this machine counting its own
 * records — see the note at the top of `lessons.ts`.
 */
export function proposalPrompt(candidate: LessonCandidate, into: DestinationInfo): string {
  const facts = {
    kind: candidate.kind,
    happened: candidate.count,
    subjects: candidate.subjects,
    repository: repoNameOf(candidate.repoDir),
    firstAt: new Date(candidate.firstAt).toISOString().slice(0, 10),
    lastAt: new Date(candidate.lastAt).toISOString().slice(0, 10),
  }

  return [
    'A tool that runs coding agents has counted something going wrong repeatedly on this',
    'machine. Here is the whole record of it, as structured data:',
    '',
    JSON.stringify(facts, null, 2),
    '',
    // Without this the model has to guess what "denied" means, and it guesses
    // wrong in a way that reads plausibly: the first real proposal blamed the
    // remote host for refusing, when it was this tool's own sandbox.
    `What "${candidate.kind}" means here: ${KIND_MEANING[candidate.kind]}`,
    '',
    `Write ONE line — at most 25 words — to be added to a file. It should be ${into.wants}.`,
    '',
    'Rules:',
    '- Say what to do differently. Not what happened, and not how many times.',
    '- Plain language. No markdown heading, no bullet, no quotes around it.',
    '- If the record is too thin to justify a rule, reply exactly: NOTHING',
    '- Reply with the line and nothing else.',
  ].join('\n')
}

/**
 * What each signal actually is, in the model's terms.
 *
 * Every one of these is a fact about *this tool*, not about the outside world,
 * and that distinction is the whole reason the clause exists — a rule written on
 * the assumption that somebody else refused you is a rule that sends the next
 * person to the wrong place.
 */
const KIND_MEANING: Record<LessonCandidate['kind'], string> = {
  'denied': 'this tool\'s own sandbox or permission rules blocked the run from reaching that '
    + 'host or using that tool. The remote side never refused anything — nothing asked it. '
    + 'The fix is either to allow it deliberately or to stop needing it.',
  'reverted': 'work this tool merged into the base branch was taken back out again afterwards '
    + 'by a human.',
  'base-broken': 'a check that had been passing in this repository started failing across '
    + 'sessions shortly after a merge went in.',
}

/** A repository name, given that the path may be a session's worktree. */
function repoNameOf(dir?: string): string | undefined {
  if (!dir) return undefined

  return repositoryRootOf(dir).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || undefined
}

/**
 * Tidy what a small model returns.
 *
 * The same cleanup `sessionSummary.ts` does and for the same reason: a leading
 * label, a stray bullet or wrapping quotes are cheaper to strip than to ask
 * about again.
 */
export function cleanLine(raw: string): string {
  const first = raw.trim().split('\n').map(line => line.trim()).filter(Boolean)[0] ?? ''

  const text = first
    .replace(/^(line|rule|answer|proposal)\s*[:\-—]\s*/i, '')
    // A bullet is a marker followed by a space. `[-*>\s]+` also ate the opening
    // `**` of a line that was legitimately bold.
    .replace(/^\s*[-*>]\s+/, '')
    .replace(/^["'“”'']+|["'“”'']+$/g, '')
    .trim()

  if (!text || /^nothing$/i.test(text)) return ''

  return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1).trimEnd()}…` : text
}

/** The model call, injectable so the rest can be tested without spending money. */
export type LineWriter = (prompt: string) => Promise<string>

export const REAL_WRITER: LineWriter = async (prompt) => {
  const { stdout } = await runClaude(
    ['-p', prompt, '--model', PROPOSAL_MODEL, '--max-turns', '1'],
    { timeout: 60_000 },
  )

  return stdout
}

export interface Proposal {
  key: string
  destination: ProposalDestination
  /** Absolute path of the file that would change. */
  path: string
  /** The proposed line, cleaned. Empty when the model declined to write one. */
  line: string
  /** What accepting would do to the file, as a diff a person reads. */
  diff: string
  creates: boolean
}

/**
 * Propose one line for one destination.
 *
 * Never writes. The diff is built from the file as it is now plus the line, so
 * what is shown is exactly what accepting does — there is no second rendering
 * path that could disagree with the write.
 */
export async function proposeLine(
  candidate: LessonCandidate,
  into: DestinationInfo,
  write: LineWriter = REAL_WRITER,
): Promise<Proposal> {
  const line = cleanLine(await write(proposalPrompt(candidate, into)))

  return {
    key: candidate.key,
    destination: into.destination,
    path: into.path,
    line,
    creates: into.creates,
    diff: line ? await diffForAppend(into, line) : '',
  }
}

/**
 * The diff, in the smallest form that is honest.
 *
 * Not a unified diff with hunk headers: this is always one added line at the end
 * of a file, and three lines of context above it says more to a person than
 * `@@ -1,4 +1,5 @@` does. The `+` prefix is the part everybody reads.
 */
export async function diffForAppend(into: DestinationInfo, line: string): Promise<string> {
  const existing = into.exists ? await readFile(into.path, 'utf8').catch(() => '') : ''
  const context = existing.split('\n').filter(Boolean).slice(-3)

  return [
    `--- ${into.path}`,
    `+++ ${into.path}`,
    ...(into.creates ? ['(this file does not exist yet — accepting creates it)'] : context.map(text => ` ${text}`)),
    `+${line}`,
  ].join('\n')
}

// --- Deciding ----------------------------------------------------------------

export interface AcceptResult {
  ok: boolean
  /** The file that changed, for saying so afterwards. */
  path?: string
  created?: boolean
  message: string
}

/**
 * Write the line, and record that it was written.
 *
 * Appends. Never rewrites and never reorders, because a proposal that could move
 * somebody else's lines is a proposal nobody would accept twice. A destination
 * whose file does not exist is created with the line in it — which is the
 * ordinary case for a repository that has no `CLAUDE.md` yet, and is said out
 * loud in the diff before anybody presses anything.
 */
export async function acceptProposal(proposal: Proposal): Promise<AcceptResult> {
  if (!proposal.line) {
    return { ok: false, message: 'There is no line to write.' }
  }

  if (proposal.destination === 'brief') {
    // The brief is a record, not a file of lines — it is appended through its
    // own store so the shape stays whatever `brief.ts` says it is.
    const { briefStore } = await import('./brief')
    await briefStore.update((current) => {
      const pinned = current.pinned?.trim()
      current.pinned = pinned ? `${pinned}\n${proposal.line}` : proposal.line
    })

    await record(proposal, 'accepted')
    return { ok: true, path: proposal.path, message: 'Added to the standing brief on this machine.' }
  }

  try {
    const existing = existsSync(proposal.path) ? await readFile(proposal.path, 'utf8') : ''
    const created = !existing

    // A trailing newline either way, so the next line to be added does not join
    // this one — this file will be appended to again.
    const head = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
    await writeFile(proposal.path, `${head}${proposal.line}\n`, 'utf8')

    await record(proposal, 'accepted')

    return {
      ok: true,
      path: proposal.path,
      created,
      message: created
        ? `Created ${proposal.path} with that line. It is a new file in your working tree — commit it to share it.`
        : `Added to ${proposal.path}. It is a change in your working tree — commit it to share it.`,
    }
  } catch (e: any) {
    return { ok: false, message: `Could not write it: ${e?.message ?? 'unknown reason'}` }
  }
}

/**
 * Record that a lesson was declined.
 *
 * The point is next week: the same three signals will still be there, and a list
 * that reopens with a suggestion somebody has already thought about and said no
 * to is a list that stops being read.
 */
export async function rejectLesson(key: string): Promise<LessonDecision> {
  const decision: LessonDecision = { key, verdict: 'rejected', at: Date.now() }

  await lessonDecisionStore.update((current) => { current[key] = decision })

  return decision
}

async function record(proposal: Proposal, verdict: LessonVerdict): Promise<void> {
  await lessonDecisionStore.update((current) => {
    current[proposal.key] = {
      key: proposal.key,
      verdict,
      at: Date.now(),
      destination: proposal.destination,
      line: proposal.line,
    }
  })
}
