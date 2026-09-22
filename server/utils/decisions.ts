import { join } from 'node:path'
import { describeToolCall } from '~/utils/toolCalls'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import type { PermissionRequest } from './permissionBroker'
import type { QuestionAnswers } from './askUserQuestion'
import type { StepSummary } from './turnActivity'

/**
 * What was decided, kept at the moment it was decided.
 *
 * Seventeen words in, twelve hundred lines out. Across the sessions on this
 * machine that still have a transcript, the human's own words come to a median
 * of seventeen per session; the branches those sessions produced come to a
 * median of 1205 lines changed. Reviewing one means reading the second number
 * to recover the first — decompiling an intent that was two sentences long out
 * of a thousand lines of its consequences.
 *
 * The one place the intent already arrives structured was thrown away on use.
 * `askUserQuestion.ts` parses a question, every option with its description, and
 * the one that was picked; `withAnswers` writes the choice back into the tool
 * input and the pair is gone the moment the tool call resolves. That pair is a
 * decision *with its alternatives still attached*, which is the single artifact
 * a diff can never yield, because a diff only ever shows the road taken.
 *
 * So this is the record, and four things write to it — a question answered, a
 * tool call refused, a turn interrupted, and a line the session wrote about
 * itself. None of them costs a model call or a turn: every one is a fact the
 * app already had and dropped.
 *
 * Two rules hold the whole thing up:
 *
 *   - **Parse, never model.** `reviewReport.ts` made this argument first and it
 *     holds unchanged here. A line this cannot read yields nothing, not a
 *     half-populated record. The failure that matters is not a thin feed — it
 *     is a decision attributed to somebody who did not take it.
 *   - **Nobody is attributed by default.** A prompt that timed out, a question
 *     allowed empty because nobody was watching, a run the app answered on its
 *     own: none of those is a decision anybody took, and none of them is
 *     written. See `PERSON_SETTLED` and its callers.
 *
 * Nothing here leaves the machine. Delivery is a later unit's problem.
 */

/** Where a decision came from, which is also how much to trust its shape. */
export type DecisionSource =
  /** A multiple-choice question a person answered. The richest of the four. */
  | 'ask_user_question'
  /** A tool call somebody refused. The alternative is the call itself. */
  | 'denied'
  /** A running turn interrupted. The alternative is what it was doing. */
  | 'steer'
  /** A `[DECISION]` line the session wrote. Prose, and no alternatives. */
  | 'marker'

/** One road, taken or not. */
export interface DecisionAlternative {
  /** The option in its own words. */
  what: string
  /** What the option said about itself, when it said anything. */
  detail?: string
  /** Set on the one that was taken. Several, when the question allowed several. */
  chosen?: true
}

export interface Decision {
  id: string
  sessionId: string
  at: number
  source: DecisionSource
  /** What was decided, in the words it was decided in. Never paraphrased. */
  what: string
  /**
   * The roads not taken, when there were any to record. Empty is honest and
   * common: a `[DECISION]` line is prose, and a steer sent at an idle session
   * interrupted nothing.
   */
  alternatives: DecisionAlternative[]
  /**
   * Why, when anybody said so on the spot. Absent means nobody has said yet —
   * which is a state a reviewer should see, not one to be filled in later by
   * guessing.
   */
  reason?: string
  /** Files the decision named itself. Never inferred from a diff. */
  files: string[]
  /** The turn it happened in, when it happened inside one. */
  runId?: string
  /**
   * Set when the app gave up asking for a reason. See `WHY_WINDOW_MS`.
   *
   * It retires the *question*, never the decision: the record still goes to a
   * reviewer, marked as having no reason given, because a reviewer seeing an
   * unexplained choice has learned something real. Holding it back until
   * somebody answered would turn a review feed into a queue of the developer's
   * own unfinished homework.
   */
  stoppedAsking?: { at: number; detail: string }
}

/**
 * How long a *why* is worth asking for.
 *
 * Three days, and the number is chosen for the one case that decides it: a
 * decision taken on Friday evening is still on the queue through the whole of
 * Monday. Past that the answer stops being a reason and becomes a
 * reconstruction — the developer is reading their own diff to work out what
 * they were thinking, which is exactly the archaeology this whole system exists
 * to abolish. `reviewDraft.ts` retires a stale draft for the same reason and
 * this follows it: retired with a sentence, never silently.
 */
export const WHY_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** A decision before the store gives it an id. */
export type NewDecision = Omit<Decision, 'id'>

interface DecisionFile {
  decisions: Decision[]
}

export const decisionsStore = defineJsonStore<DecisionFile>({
  label: 'decisions',
  path: () => join(getClaudeDir(), 'agents-ui', 'decisions.json'),
  empty: () => ({ decisions: [] }),
  decode: (parsed: any) => ({
    decisions: Array.isArray(parsed?.decisions)
      ? parsed.decisions.map((entry: any): Decision => ({
          ...entry,
          // Both lists predate nothing, but a record hand-edited into the file
          // should not be able to crash every reader of it.
          alternatives: Array.isArray(entry?.alternatives) ? entry.alternatives : [],
          files: Array.isArray(entry?.files) ? entry.files : [],
        }))
      : [],
  }),
  encode: value => ({ version: 1, decisions: value.decisions }),
})

function newDecisionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * File the decision, unless the same one is already filed.
 *
 * The duplicate guard is for markers. A turn's output is parsed when the turn
 * ends, and the same output can be read again — a repair turn re-reporting, a
 * recompose — so the same sentence would otherwise become two decisions and a
 * reviewer would be told twice about one choice. Matched on the run it came
 * from, its source and its words, which is exactly what makes it the same fact.
 */
export async function recordDecision(entry: NewDecision): Promise<Decision | null> {
  if (!entry.sessionId || !entry.what.trim()) return null

  return decisionsStore.update((file) => {
    const already = file.decisions.some(other =>
      other.sessionId === entry.sessionId
      && other.source === entry.source
      && other.runId === entry.runId
      && other.what === entry.what)
    if (already) return null

    const decision: Decision = { id: newDecisionId(), ...entry }
    file.decisions.push(decision)
    return decision
  })
}

/** Every decision taken in one session, oldest first. */
export async function decisionsFor(sessionId: string): Promise<Decision[]> {
  const { decisions } = await decisionsStore.read()
  return decisions.filter(d => d.sessionId === sessionId).sort((a, b) => a.at - b.at)
}

/**
 * Whether a settled prompt was settled by a person.
 *
 * The broker settles for four different reasons and only one of them is
 * somebody deciding something. A prompt that ran out its ten minutes, a run
 * that was stopped, a session disposed at the end of a turn — all three arrive
 * at `onSettled` looking exactly like a refusal, and filing them would put a
 * denial on the record that nobody made. See `permissionBroker`'s `SettledBy`.
 */
export const PERSON_SETTLED = 'answer' as const

/**
 * The decisions in an answered question: one per question, because two
 * questions in one prompt are two choices and a reviewer reads them separately.
 *
 * An unanswered question yields nothing. That is not a gap — the CLI's own
 * encoding of "nobody was there" is an allow with no answers in it, which is
 * precisely the case this must not record as a decision somebody took.
 */
export function questionDecisions(
  request: PermissionRequest,
  answers: QuestionAnswers | undefined,
  context: { sessionId: string; runId?: string; at?: number },
): NewDecision[] {
  if (!request.questions?.length || !answers) return []

  const at = context.at ?? Date.now()
  const decisions: NewDecision[] = []

  for (const question of request.questions) {
    const picked = (answers[question.question] ?? [])
      .map(value => value.trim())
      .filter(Boolean)
    if (!picked.length) continue

    const alternatives: DecisionAlternative[] = question.options.map(option => ({
      what: option.label,
      ...(option.description ? { detail: option.description } : {}),
      ...(picked.includes(option.label) ? { chosen: true as const } : {}),
    }))

    // Somebody typed their own answer instead of picking one. It is the road
    // taken and it is not in the list, so it goes on the end rather than being
    // dropped for not matching an option.
    for (const own of picked) {
      if (alternatives.some(alternative => alternative.what === own)) continue
      alternatives.push({ what: own, chosen: true })
    }

    decisions.push({
      sessionId: context.sessionId,
      at,
      source: 'ask_user_question',
      what: question.question,
      alternatives,
      files: [],
      ...(context.runId ? { runId: context.runId } : {}),
    })
  }

  return decisions
}

/** `Bash` with a command in it, as the one line a card can carry. */
function callLine(toolName: string, input: Record<string, unknown>): string {
  const { verb, target } = describeToolCall({ toolName, input })
  const line = target ? `${verb} ${target}` : verb
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

/**
 * The decision in a refusal.
 *
 * The refused call is the alternative and it is deliberately not marked chosen:
 * saying no to `rm -rf` is a decision whose other road is the command itself,
 * and that road was not taken.
 */
export function denialDecision(
  request: PermissionRequest,
  message: string | undefined,
  context: { sessionId: string; runId?: string; at?: number },
): NewDecision | null {
  // A question is refused through the same queue and is not a refused tool
  // call. Nothing about "nobody answered in an hour" belongs on this record.
  if (request.questions?.length) return null

  const call = callLine(request.toolName, request.input)

  return {
    sessionId: context.sessionId,
    at: context.at ?? Date.now(),
    source: 'denied',
    what: `Refused ${request.toolName}`,
    alternatives: [{
      what: call,
      ...(request.decisionReason ? { detail: request.decisionReason } : {}),
    }],
    // Whoever refused usually said why, in the box next to the button.
    ...(message?.trim() ? { reason: message.trim() } : {}),
    files: request.blockedPath ? [request.blockedPath] : [],
    ...(context.runId ? { runId: context.runId } : {}),
  }
}

/** Enough of a steer to read on a card; the turn keeps the whole of it. */
const MAX_STEER = 400

/**
 * The decision in an interruption.
 *
 * "No, not that file" is a product decision taken at speed, and the thing it
 * overrode is the step the turn was in the middle of. When nothing was running
 * there is no such step, and the record says so by carrying no alternatives
 * rather than by inventing one — a steer typed at an idle session is an
 * instruction, and an instruction has no road not taken.
 */
export function steerDecision(
  input: string,
  doing: StepSummary | null,
  context: { sessionId: string; runId?: string; at?: number },
): NewDecision | null {
  const what = input.trim()
  if (!what) return null

  return {
    sessionId: context.sessionId,
    at: context.at ?? Date.now(),
    source: 'steer',
    what: what.length > MAX_STEER ? `${what.slice(0, MAX_STEER)}…` : what,
    alternatives: doing
      ? [{ what: callLine(doing.toolName, doing.input), detail: 'what the turn was doing' }]
      : [],
    files: [],
    ...(context.runId ? { runId: context.runId } : {}),
  }
}

/**
 * Written by a model, so matched the way `selfReported.ts` matches `[SKIP]`:
 * anchored to the start of the line, after bullets and decoration and nothing
 * else. A `[DECISION]` mid-sentence is prose *about* the convention, and the
 * contract documenting itself is the likeliest thing to write one.
 */
const MARKER = /^[-*+>\s]*[`*_]*\[DECISION\][`*_:]*\s*/i

/**
 * More than this in one turn and the marker has stopped meaning anything. A
 * turn that took twelve decisions did not; it narrated.
 */
const MOST = 12

/** ` **the queue** ` → `the queue`. */
function plain(text: string): string {
  return text.replace(/[`*_]/g, '').trim()
}

/**
 * Split the decision from its reason on the first separator only. Reasons
 * contain dashes of their own, and taking the last would put half the sentence
 * in the decision.
 */
function split(line: string): { what: string; reason: string } {
  // A line that opens with the separator gave a reason and no decision. Read
  // that way rather than as a decision called "— because", which is what taking
  // the text before the first separator would otherwise produce.
  const lead = line.match(/^[—–:-]\s+/)
  if (lead) return { what: '', reason: line.slice(lead[0].length).trim() }

  const at = line.search(/\s+[—–]\s+|\s+-\s+|:\s+/)
  if (at === -1) return { what: line.trim(), reason: '' }

  const separator = line.slice(at).match(/^\s+[—–]\s+|^\s+-\s+|^:\s+/)![0]
  return {
    what: line.slice(0, at).trim(),
    reason: line.slice(at + separator.length).trim(),
  }
}

/**
 * Files the line named, and only those.
 *
 * A backticked token with a slash or an extension in it is a path somebody
 * wrote down. Everything else in backticks is a symbol — `withAnswers`,
 * `jsonStore` — and turning those into filenames would be the invention this
 * module exists to avoid.
 */
function pathsIn(line: string): string[] {
  const found: string[] = []

  for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
    const candidate = token!.trim()
    if (!/^[\w.@/\\-]+$/.test(candidate)) continue
    if (!candidate.includes('/') && !/\.\w{1,5}$/.test(candidate)) continue
    if (!found.includes(candidate)) found.push(candidate)
  }

  return found
}

export interface MarkerDecision {
  what: string
  reason?: string
  files: string[]
}

export interface ParsedMarkers {
  decisions: MarkerDecision[]
  /**
   * Lines that carried the marker and nothing this could read. Shown, never
   * guessed at — the `violations` precedent in `reviewDraft.ts`. A count of
   * zero decisions and three violations is a contract somebody is writing
   * wrong, which is a different problem from a turn that decided nothing.
   */
  violations: string[]
}

/**
 * The decisions a session wrote down about itself.
 *
 * Pure and cheap: a regex over output the turn already produced, run once where
 * the turn ends. Fenced code is stepped over, because `CONTRACT.md` documents
 * this convention by quoting it and a session reading the contract back is not
 * a session deciding anything.
 */
export function parseDecisionMarkers(output: string | undefined): ParsedMarkers {
  const empty: ParsedMarkers = { decisions: [], violations: [] }
  if (!output || !output.toUpperCase().includes('[DECISION]')) return empty

  const decisions: MarkerDecision[] = []
  const violations: string[] = []
  const seen = new Set<string>()
  let fenced = false

  for (const raw of output.split('\n')) {
    const line = raw.trim()

    if (line.startsWith('```') || line.startsWith('~~~')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue

    const marker = line.match(MARKER)
    if (!marker) continue

    const rest = line.slice(marker[0].length).trim()
    const { what, reason } = split(rest)
    const words = plain(what)

    if (!words) {
      violations.push(`"${line}" carries the marker and no decision, so nothing was recorded.`)
      continue
    }

    // The same decision restated twice in one turn is one decision. A turn that
    // summarises itself at the end is the case that produces it.
    const key = words.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    decisions.push({
      what: words,
      ...(reason ? { reason: plain(reason) } : {}),
      files: pathsIn(rest),
    })

    if (decisions.length >= MOST) break
  }

  return { decisions, violations }
}

/**
 * File everything a finished turn said it decided.
 *
 * Detached from the turn on purpose, like the checks and the summary beside it:
 * a store write must not be able to fail a turn that has already finished and
 * been reported.
 */
export async function recordMarkers(
  output: string | undefined,
  context: { sessionId: string; runId?: string; at?: number },
): Promise<Decision[]> {
  const { decisions } = parseDecisionMarkers(output)
  const filed: Decision[] = []

  for (const marker of decisions) {
    const decision = await recordDecision({
      sessionId: context.sessionId,
      at: context.at ?? Date.now(),
      source: 'marker',
      what: marker.what,
      alternatives: [],
      ...(marker.reason ? { reason: marker.reason } : {}),
      files: marker.files,
      ...(context.runId ? { runId: context.runId } : {}),
    })
    if (decision) filed.push(decision)
  }

  return filed
}

/**
 * Whether this decision is still worth asking about.
 *
 * Three ways it is not: somebody already said why, the app already gave up
 * asking, or it is older than the window. A refusal usually answers the first
 * of those on its own — `denialDecision` keeps whatever was typed into the deny
 * box as the reason — but a refusal somebody pressed without typing anything is
 * a decision with no reason, and it is asked about like the rest.
 */
export function wantsReason(decision: Decision, now = Date.now()): boolean {
  if (decision.reason?.trim()) return false
  if (decision.stoppedAsking) return false
  return now - decision.at < WHY_WINDOW_MS
}

/**
 * The sentence for a *why* that ran out of time, or null while it still has any.
 *
 * Pure, so the window is testable without a clock and without a store — the
 * `retirementFor` precedent in `reviewRetire.ts`.
 */
export function whyRetirement(
  decision: Decision,
  now = Date.now(),
): { at: number; detail: string } | null {
  if (decision.reason?.trim() || decision.stoppedAsking) return null
  if (now - decision.at < WHY_WINDOW_MS) return null

  return {
    at: now,
    detail: `Nobody said why within ${Math.round(WHY_WINDOW_MS / 86_400_000)} days, so this stopped asking. `
      + 'The decision still goes to a reviewer, marked as having no reason given.',
  }
}

/** One session's unanswered decisions, batched the way the queue shows them. */
export interface UnansweredSession {
  sessionId: string
  /** The session's own title, so the row does not read as an id. */
  title: string
  decisions: Decision[]
}

/**
 * Everything still worth asking about, by session, and the retirements applied
 * on the way past.
 *
 * Retiring on read rather than on a timer, for the reason `reviewRetire.ts`
 * gives about the same choice: a background sweep that only ever changes rows
 * nobody is looking at is machinery bought for nothing, and the moment somebody
 * looks is the moment the answer has to be right.
 *
 * Sessions that no longer exist are left out. A decision taken in a session you
 * have since closed is still delivered — 41 carries it either way — but a row
 * in the queue is a claim that pressing it leads somewhere, and that one leads
 * to a page about a session that is gone. The store on this machine has 239
 * session ids across its runs against 144 sessions on disk, so this is the
 * common case and not the edge.
 */
export async function unansweredReasons(
  titleFor: (sessionId: string) => Promise<string | null>,
  now = Date.now(),
): Promise<UnansweredSession[]> {
  const live = await decisionsStore.update((file) => {
    const keep: Decision[] = []

    for (const decision of file.decisions) {
      const retirement = whyRetirement(decision, now)
      if (retirement) {
        decision.stoppedAsking = retirement
        continue
      }
      if (wantsReason(decision, now)) keep.push(decision)
    }

    return keep
  })

  const bySession = new Map<string, Decision[]>()
  for (const decision of live) {
    const held = bySession.get(decision.sessionId)
    if (held) held.push(decision)
    else bySession.set(decision.sessionId, [decision])
  }

  const sessions: UnansweredSession[] = []
  for (const [sessionId, decisions] of bySession) {
    const title = await titleFor(sessionId)
    if (!title) continue
    sessions.push({ sessionId, title, decisions: decisions.sort((a, b) => a.at - b.at) })
  }

  // Oldest first: the decision closest to running out of time is the one worth
  // answering, and it is the one whose reason is still most nearly intact.
  return sessions.sort((a, b) => (a.decisions[0]?.at ?? 0) - (b.decisions[0]?.at ?? 0))
}

/**
 * Write the reason somebody gave, on the one record it is about.
 *
 * Returns null for an id that is not there — a decision answered twice from two
 * tabs, or one whose store was reset — because a 404 for a row that has already
 * done its job is a worse answer than nothing happening.
 */
export async function setDecisionReason(id: string, reason: string): Promise<Decision | null> {
  const said = reason.trim()
  if (!said) return null

  return decisionsStore.update((file) => {
    const decision = file.decisions.find(d => d.id === id)
    if (!decision) return null

    decision.reason = said
    // Answering it is also the end of asking about it. Without this a reason
    // given on the last day would leave a record that both has a reason and is
    // marked as having stopped asking for one, which reads as a contradiction
    // wherever the two are shown together.
    delete decision.stoppedAsking
    return decision
  })
}
