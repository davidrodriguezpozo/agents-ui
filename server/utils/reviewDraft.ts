import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { readRun } from './runStore'
import { findSession, type Session } from './sessions'
import {
  anchorFor,
  diffPositions,
  resolveBaseRef,
  type Anchor,
} from './reviewAnchors'
import {
  commentBody,
  includeByDefault,
  parseReviewReport,
  suggestedEvent,
  type ParsedReport,
  type ReportSeverity,
} from './reviewReport'

/**
 * A review, composed and waiting for you to send it.
 *
 * The session's review is prose in a conversation; a GitHub review is a body, a
 * verdict and a list of anchored comments. This is the thing in between, and it
 * is durable for the same reason a landing run is: it holds edits somebody made
 * by hand, and losing those to a closed tab would teach them not to make any.
 *
 * Two properties are the whole point, and both are about the agent:
 *
 *   - **The agent never posts.** The reviewing session holds no write tool for
 *     GitHub and the prompts still tell it not to try. What reaches GitHub is
 *     this record, sent by the server, after somebody read it. A diff that
 *     talked its way into the review cannot talk its way into publishing it.
 *   - **Nothing here is invented.** The bodies come from the report by parsing,
 *     the anchors from the real diff. A finding this cannot ground is shown as
 *     unanchored rather than moved somewhere plausible.
 */

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE'

/** Why a composed review stopped being something anybody could send. */
export type RetireReason =
  /** You submitted a review on GitHub yourself after this was composed. */
  | 'already_reviewed'
  /** The pull request is closed or merged, so a review would reach nobody. */
  | 'pr_closed'
  /** It has been pushed to since, so every anchor these comments carry is dead. */
  | 'head_moved'
  /**
   * The session that composed it has been closed, so nobody is coming back to
   * press send. A reviewing session often posts its own review from the chat —
   * `gh` in the conversation, this app never told — and closing it is the last
   * thing you do afterwards. Either way a closed session is a finished one.
   */
  | 'session_closed'

export interface Retirement {
  at: number
  reason: RetireReason
  /** One sentence, for wherever the draft is explained rather than counted. */
  detail: string
}

export interface DraftFinding {
  /** Stable across recomposes, so an edit survives one. */
  id: string
  location: string
  severity: ReportSeverity
  category: string
  /** What will be posted. Editable, and usually the report's detailed block. */
  body: string
  /** Set when the person changed the body, so a recompose leaves it alone. */
  edited?: true
  /** A fenced block from the report, offered as a GitHub suggestion. */
  suggestion?: string
  useSuggestion: boolean
  /** Unchecked findings are kept, not dropped: unchecking is not deleting. */
  include: boolean
  anchor: Anchor
  /**
   * A thread already open on the pull request that says this.
   *
   * Matched on location alone, so it is a prompt to look rather than a verdict —
   * hence unchecked-but-kept rather than removed. A second comment repeating
   * what a colleague already wrote is how a review reads as noise.
   */
  alreadyRaised?: string
}

export interface ReviewDraft {
  sessionId: string
  pr: number
  /** The commit the findings describe. Checked again before anything is posted. */
  headSha: string
  /** The ref the anchors were computed against. */
  baseRef: string
  event: ReviewEvent
  summary: string
  /** Set when the person rewrote the summary, so a recompose leaves it alone. */
  summaryEdited?: true
  findings: DraftFinding[]
  /**
   * The reviewer's proof-of-work, kept whole and off by default.
   *
   * `## Scope` and `## Feature model` are written for the person who asked for
   * the review. The author of the pull request did not ask for a description of
   * how thoroughly they were reviewed.
   */
  context?: string
  includeContext: boolean
  /** Where the report broke its own format. Shown, never posted. */
  violations: string[]
  composedAt: number
  /** The run whose output this was parsed from. */
  runId?: string
  posted?: { at: number; url: string; event: ReviewEvent; comments: number }
  /**
   * Set when GitHub said this can no longer be sent — see `reviewRetire`.
   *
   * Kept rather than deleted, and separate from `posted`, because the two are
   * different claims. `posted` means this app sent it and can link to it;
   * `retired` means it went out some other way, or the pull request moved out
   * from under it. Writing the second into the first would put a review in your
   * sent record that this app never sent.
   *
   * Cleared by a recompose: a new turn is a new opinion, and the next reading
   * will retire it again if it is still stale.
   */
  retired?: Retirement
}

interface DraftFile {
  drafts: ReviewDraft[]
}

export const reviewDraftStore = defineJsonStore<DraftFile>({
  label: 'review drafts',
  path: () => join(getClaudeDir(), 'agents-ui', 'review-drafts.json'),
  empty: () => ({ drafts: [] }),
  decode: (parsed: any) => ({ drafts: Array.isArray(parsed?.drafts) ? parsed.drafts : [] }),
  encode: value => ({ version: 1, drafts: value.drafts }),
})

export async function findDraft(sessionId: string): Promise<ReviewDraft | null> {
  const { drafts } = await reviewDraftStore.read()
  return drafts.find(d => d.sessionId === sessionId) ?? null
}

export async function saveDraft(draft: ReviewDraft): Promise<ReviewDraft> {
  return reviewDraftStore.update((file) => {
    const at = file.drafts.findIndex(d => d.sessionId === draft.sessionId)
    if (at === -1) file.drafts.push(draft)
    else file.drafts[at] = draft
    return draft
  })
}

/**
 * Whether a draft is still something a person could press send on.
 *
 * A review with nothing checked but a written summary counts: "I read this and
 * it looks fine" is a review, and it is the one a reviewer is most likely to
 * forget to send.
 */
export function isPending(draft: ReviewDraft): boolean {
  return !draft.posted
    && !draft.retired
    && (draft.findings.some(f => f.include) || Boolean(draft.summary.trim()))
}

/**
 * A session's title with the pull request number taken off the front.
 *
 * A review session is titled `#5831 fix(fina): …` — the number is how you find
 * it in a rail of forty. The band on Land draws the number itself, from the
 * draft, and then drew the title after it, so the row read
 * `#5831 #5831 fix(fina): …`. Twice, in the same six characters.
 *
 * Only its *own* number comes off. `#5831` on a draft for #5831 is the
 * duplicate; a title that happens to mention #4102 is the author saying
 * something, and stripping that would be editing the sentence.
 */
export function titleWithoutNumber(pr: number, title: string): string {
  return title.replace(new RegExp(`^\\s*#${pr}\\b[\\s:—-]*`), '').trim() || title.trim()
}

/** Drafts composed and not yet sent, for the band on Land. */
export async function pendingDrafts(): Promise<ReviewDraft[]> {
  const { drafts } = await reviewDraftStore.read()
  return drafts.filter(isPending)
}

/**
 * Drafts retired since a moment, for saying so once rather than never.
 *
 * A row that vanishes with no explanation is the same problem as a row that
 * should have vanished and did not: both leave you unsure what the list means.
 * So Land gets a count for a day afterwards, and then stops mentioning it.
 */
export async function retiredSince(at: number): Promise<ReviewDraft[]> {
  const { drafts } = await reviewDraftStore.read()
  return drafts.filter(d => d.retired && d.retired.at >= at)
}

/**
 * The report to compose from: the newest thing this session actually said.
 *
 * Newest rather than first, because a review gets asked follow-up questions
 * ("what about the migration?") and the answer to the last one is the current
 * state of the reviewer's opinion. A turn that produced no report at all leaves
 * the previous draft alone — see the endpoint.
 */
export async function latestReport(session: Session): Promise<{ text: string; runId: string } | null> {
  for (const runId of [...session.runIds].reverse()) {
    const run = await readRun(runId)
    if (!run?.output?.trim()) continue
    if (parseReviewReport(run.output)) return { text: run.output, runId }
  }
  return null
}

function findingId(location: string, index: number): string {
  return `${index}:${location.toLowerCase().replace(/[^a-z0-9.:/_-]+/g, '-')}`
}

/**
 * Turn a parsed report into a draft, anchored against the real diff.
 *
 * `previous` carries edits forward. Recomposing after a follow-up turn must not
 * silently revert a body somebody rewrote — that is the one thing that would
 * make the pane untrustworthy, because the text you approved and the text that
 * gets sent would differ and nothing would say so.
 */
export async function composeDraft(options: {
  session: Session
  report: ParsedReport
  runId?: string
  previous?: ReviewDraft | null
}): Promise<ReviewDraft> {
  const { session, report, runId, previous } = options

  if (!session.reviewOf) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'not_a_review',
        message: 'This session was not opened to review a pull request, so there is nothing to compose.',
      },
    })
  }

  // The workspace is what the anchors are computed from, so a pruned one is a
  // refusal rather than a stack trace. The report is still in the conversation;
  // what is gone is the diff that says where each finding lands, and guessing
  // that is the one thing this must not do.
  if (!existsSync(session.worktreePath)) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'no_workspace',
        message:
          'This review\'s workspace is gone, so there is no diff to place the findings against. '
          + 'The review itself is still in the conversation.',
      },
    })
  }

  const baseRef = await resolveBaseRef(session.worktreePath, session.baseBranch)
  const positions = await diffPositions(session.worktreePath, baseRef)

  const raised = new Map(
    report.openComments
      .filter(c => c.location)
      .map(c => [c.location!.toLowerCase(), `${c.author}: “${c.quote}”`]),
  )

  const findings: DraftFinding[] = report.findings.map((finding, index) => {
    const id = findingId(finding.location, index)
    const before = previous?.findings.find(f => f.id === id)
    const alreadyRaised = raised.get(finding.location.toLowerCase())

    return {
      id,
      location: finding.location,
      severity: finding.severity,
      category: finding.category,
      // An edited body wins over a freshly parsed one, always.
      body: before?.edited ? before.body : commentBody(finding),
      edited: before?.edited,
      suggestion: finding.suggestion,
      useSuggestion: before?.useSuggestion ?? false,
      include: before ? before.include : includeByDefault(finding) && !alreadyRaised,
      anchor: anchorFor(finding, positions),
      alreadyRaised,
    }
  })

  const context = [report.context.scope, report.context.featureModel, report.context.commits]
    .filter(Boolean)
    .join('\n\n')

  return {
    sessionId: session.id,
    pr: session.reviewOf.number,
    headSha: session.reviewOf.headSha,
    baseRef,
    event: previous?.event ?? suggestedEvent(report),
    summary: previous?.summaryEdited ? previous.summary : report.summary ?? '',
    summaryEdited: previous?.summaryEdited,
    findings,
    context: context || undefined,
    includeContext: previous?.includeContext ?? false,
    violations: report.violations,
    composedAt: Date.now(),
    runId,
  }
}

/**
 * Compose the review after a review session's turn.
 *
 * Never throws. A review that failed to compose must not make the turn that
 * produced it look failed — the report is in the conversation either way, and
 * the pane will compose it on demand when somebody opens it. A missing draft is
 * a missing row on Land; a turn reported as failed sends somebody looking for a
 * problem that is not there.
 *
 * Edits are carried across, so this running after a follow-up turn cannot revert
 * a body somebody rewrote.
 */
export async function composeAfterTurn(sessionId: string): Promise<void> {
  try {
    const session = await findSession(sessionId)
    if (!session?.reviewOf) return

    const previous = await findDraft(sessionId)
    // A review already sent is a record, not a draft. Recomposing over it would
    // offer to send a second one.
    if (previous?.posted) return

    const report = await latestReport(session)
    if (!report) return

    const parsed = parseReviewReport(report.text)
    if (!parsed) return

    await saveDraft(await composeDraft({ session, report: parsed, runId: report.runId, previous }))
  } catch (e: any) {
    console.log(`[review] could not compose for ${sessionId}: ${e?.message ?? e}`)
  }
}
