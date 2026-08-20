import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { describeDegraded } from './reviewAnchors'
import type { DraftFinding, ReviewDraft } from './reviewDraft'

const exec = promisify(execFile)

/**
 * Sending the review.
 *
 * The only thing in this app that writes to somebody else's pull request, which
 * is why it is a file of its own rather than a branch inside an endpoint. Two
 * facts about it are worth stating where they cannot be missed:
 *
 *   - **No agent reaches this.** The reviewing session is read-only and its
 *     prompt still says so. This runs from a draft a person read and edited, in
 *     response to a press. There is no tool an agent could call to get here.
 *   - **One review, not N comments.** Eight separate comment posts are eight
 *     notifications for the author and no way to read them as one opinion. A
 *     pending review with its comments inside arrives once, as a review.
 *
 * The gates are in `guard` below, each with the failure it exists for.
 */

async function gh(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('gh', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

/**
 * `gh api` with a body on stdin.
 *
 * On stdin rather than in an argument because a review body carries newlines,
 * backticks and whatever the reviewer wrote about a shell command, and argv is
 * the wrong place for all three. It also has a length limit that a review with
 * a dozen findings would eventually find.
 */
async function ghInput(cwd: string, args: string[], body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', [...args, '--input', '-'], { cwd })
    let out = ''
    let err = ''

    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(err.trim() || `gh exited ${code}`))
    })

    child.stdin.end(JSON.stringify(body))
  })
}

export interface PostableReview {
  event: ReviewDraft['event']
  body: string
  comments: {
    path: string
    body: string
    line?: number
    side?: 'RIGHT' | 'LEFT'
    subject_type?: 'file'
  }[]
  /** Findings that went into the body instead, so the caller can say how many. */
  folded: number
}

/**
 * A finding's comment text, with its suggestion block if it is being used.
 *
 * The suggestion is appended rather than replacing the body: a bare
 * ```suggestion block with no explanation is a change the author is asked to
 * accept without being told why.
 */
export function renderComment(finding: DraftFinding): string {
  const body = finding.body.trim()
  if (!finding.useSuggestion || !finding.suggestion) return body

  return `${body}\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``
}

/**
 * Assemble what will be sent.
 *
 * Kept apart from the sending so it can be tested without a network, and so the
 * pane can show exactly this — a preview built by different code from the thing
 * that posts would be a preview that can lie.
 */
export function buildReview(draft: ReviewDraft): PostableReview {
  const included = draft.findings.filter(f => f.include && f.body.trim())

  const inline = included.filter(f => f.anchor.kind === 'inline' || f.anchor.kind === 'file')
  const folded = included.filter(f => f.anchor.kind === 'summary')

  const comments = inline.map(f => ({
    path: f.anchor.path!,
    body: renderComment(f),
    ...(f.anchor.kind === 'inline'
      ? { line: f.anchor.line!, side: f.anchor.side ?? 'RIGHT' }
      : { subject_type: 'file' as const }),
  }))

  // Everything that could not be attached to a line, said in the body rather
  // than dropped. The list of what moved comes first, then the findings
  // themselves, because "one finding was moved" without the finding is worse
  // than not mentioning it.
  const degraded = describeDegraded(included.map(f => ({ location: f.location, anchor: f.anchor })))

  const sections = [draft.summary.trim()]

  if (folded.length) {
    sections.push(
      folded
        .map(f => `**${f.location || 'General'}** — ${renderComment(f)}`)
        .join('\n\n'),
    )
  }

  if (degraded) sections.push(degraded)
  if (draft.includeContext && draft.context) sections.push('<details>\n<summary>Review scope</summary>\n\n' + draft.context + '\n</details>')

  return {
    event: draft.event,
    body: sections.filter(s => s?.trim()).join('\n\n---\n\n'),
    comments,
    folded: folded.length,
  }
}

export type PostRefusal =
  | { ok: false; error: 'already_posted'; message: string }
  | { ok: false; error: 'nothing_to_post'; message: string }
  | { ok: false; error: 'head_moved'; message: string }
  | { ok: false; error: 'pr_closed'; message: string }
  | { ok: false; error: 'gh_failed'; message: string }

/**
 * What has to be true for a review to go out.
 *
 * Each of these is a specific way this feature could put something wrong under
 * your name, rather than a general caution:
 *
 *   - **Already posted.** A second press must not send a second review. The
 *     record of the first is kept, so this is answerable without asking GitHub.
 *   - **Nothing to post.** Every finding unchecked and an empty summary is a
 *     press somebody made by accident. An empty review is worse than none: it
 *     notifies the author to come and read nothing.
 *   - **The head moved.** This is the important one. Every anchor was computed
 *     against a commit; if the author has pushed since, those line numbers
 *     describe code that no longer exists and the comments would land on
 *     unrelated lines. The same rule the checks already follow — a verdict has a
 *     shelf life — applied to a review.
 *   - **The pull request closed.** Reviewing something already merged is not
 *     harmful, just useless, and being told is better than a 422.
 */
export async function guard(draft: ReviewDraft, cwd: string): Promise<PostRefusal | { ok: true; headSha: string }> {
  if (draft.posted) {
    return {
      ok: false,
      error: 'already_posted',
      message: `This review was already sent — ${draft.posted.url}. Compose a new one if there is more to say.`,
    }
  }

  const review = buildReview(draft)
  if (!review.comments.length && !review.body.trim()) {
    return {
      ok: false,
      error: 'nothing_to_post',
      message: 'Nothing is checked and the summary is empty, so there is no review to send.',
    }
  }

  // Read GitHub now rather than trusting the page. Same rule the merge button
  // and the reviews page already follow: the screen's minute-old copy decides
  // what to offer, never what to do.
  let live: { state: string; headRefOid: string }
  try {
    const raw = await gh(cwd, ['pr', 'view', String(draft.pr), '--json', 'state,headRefOid'])
    live = JSON.parse(raw)
  } catch (e: any) {
    return {
      ok: false,
      error: 'gh_failed',
      message: `GitHub could not be asked about #${draft.pr}: ${e?.message ?? e}`,
    }
  }

  if (live.state !== 'OPEN') {
    return {
      ok: false,
      error: 'pr_closed',
      message: `#${draft.pr} is ${live.state.toLowerCase()}, so a review would not reach anybody.`,
    }
  }

  if (live.headRefOid && live.headRefOid !== draft.headSha) {
    return {
      ok: false,
      error: 'head_moved',
      message:
        `#${draft.pr} has been pushed to since this review was taken — it is now at `
        + `\`${live.headRefOid.slice(0, 12)}\`, the review read \`${draft.headSha.slice(0, 12)}\`. `
        + 'Every line these comments point at may have moved, so nothing has been sent. '
        + 'Review it again on the new commit.',
    }
  }

  return { ok: true, headSha: live.headRefOid || draft.headSha }
}

export interface PostedReview {
  url: string
  event: ReviewDraft['event']
  comments: number
  folded: number
}

/**
 * Post it.
 *
 * `commit_id` is sent explicitly. Without it GitHub attaches the review to
 * whatever the head is when it arrives, which is the same stale-anchor problem
 * the guard just refused — belt and braces, because the window between the
 * guard and this call is small but not zero.
 */
export async function postReview(draft: ReviewDraft, cwd: string): Promise<PostedReview> {
  const review = buildReview(draft)

  const raw = await ghInput(
    cwd,
    ['api', `repos/{owner}/{repo}/pulls/${draft.pr}/reviews`, '--method', 'POST'],
    {
      commit_id: draft.headSha,
      event: draft.event,
      body: review.body,
      comments: review.comments,
    },
  )

  const parsed = JSON.parse(raw || '{}')

  return {
    url: parsed.html_url ?? `#${draft.pr}`,
    event: draft.event,
    comments: review.comments.length,
    folded: review.folded,
  }
}
