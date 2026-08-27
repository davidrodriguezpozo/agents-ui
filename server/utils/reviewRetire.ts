import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { reviewDraftStore, type Retirement, type ReviewDraft } from './reviewDraft'

const exec = promisify(execFile)

/**
 * Which composed reviews are still worth offering to send.
 *
 * The draft store only ever learned one thing: that *this app* posted a review,
 * written by `post.post.ts` after the send succeeded. Everything else that ends
 * a review's life happened somewhere this app was not looking — you reviewed the
 * pull request in a browser tab, or from `gh`, or the author merged it, or they
 * pushed twice more while the draft sat there. None of that touched the file, so
 * "Reviews waiting to be sent" grew into a list of work already done, which is
 * the worst thing a to-do band can become: not wrong loudly, wrong quietly, until
 * you stop reading it.
 *
 * So the band asks GitHub. Three questions, in one round trip per repository:
 * is it still open, did you already review it yourself, and is it still the
 * commit these comments were anchored against. Any of those, and the draft is
 * *retired* — kept in the store as a record, dropped from the band.
 *
 * Two properties this is built around:
 *
 *   - **Retirement is durable.** It is written back to the draft, so a review
 *     already answered costs one question ever rather than one per page load.
 *     The set this has to ask about shrinks toward empty, which is what keeps
 *     the band cheap enough to sit next to a poll.
 *   - **Silence never retires anything.** `gh` missing, signed out, offline, a
 *     repository it cannot resolve: every one of those leaves every draft alone
 *     and is reported as unchecked. Hiding a review you have not sent because a
 *     network call failed is the one failure that loses work here.
 */

export interface LivePull {
  number: number
  /** GitHub's own word: `OPEN`, `CLOSED` or `MERGED`. */
  state: string
  headRefOid: string
  /** When you last submitted a review on it, or null if you never have. */
  reviewedByYouAt: number | null
}

/**
 * What GitHub's answer means for one draft.
 *
 * Ordered by which fact explains the most. Closed first, because it makes the
 * other two irrelevant — nothing reaches anybody on a merged pull request.
 * Then a review of your own, because when you have both reviewed it *and* the
 * author has pushed since, "you already did this" is the sentence you need and
 * "the commit moved" is a detail about a job that is finished.
 *
 * `submittedAt >= composedAt` rather than "any review by you at all": reviewing
 * a pull request in March and asking for a fresh read of it in August is a draft
 * that is genuinely waiting. Only a review that came *after* this one was written
 * is the same opinion arriving by another route.
 */
export function retirementFor(draft: ReviewDraft, live: LivePull, at: number): Retirement | null {
  if (live.state && live.state !== 'OPEN') {
    return {
      at,
      reason: 'pr_closed',
      detail: `#${draft.pr} is ${live.state.toLowerCase()}, so a review would not reach anybody.`,
    }
  }

  if (live.reviewedByYouAt !== null && live.reviewedByYouAt >= draft.composedAt) {
    return {
      at,
      reason: 'already_reviewed',
      detail: `You submitted a review on #${draft.pr} yourself after this one was composed.`,
    }
  }

  if (live.headRefOid && live.headRefOid !== draft.headSha) {
    return {
      at,
      reason: 'head_moved',
      detail:
        `#${draft.pr} has been pushed to since this was composed — it is now at `
        + `\`${live.headRefOid.slice(0, 12)}\`, the review read \`${draft.headSha.slice(0, 12)}\`. `
        + 'Every line these comments point at may have moved.',
    }
  }

  return null
}

async function gh(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('gh', args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024 })
  return stdout
}

interface GraphqlAnswer {
  data?: {
    viewer?: { login?: string }
    repository?: Record<string, {
      number?: number
      state?: string
      headRefOid?: string
      reviews?: { nodes?: { submittedAt?: string | null; author?: { login?: string } | null }[] }
    } | null>
  }
}

/**
 * The three facts about every draft's pull request, in one query.
 *
 * Aliased per number rather than paged, the way `readThreadCounts` does it: the
 * set is already known and small, and a pull request reviewed twice by two
 * sessions collapses to one alias because the key is the number.
 *
 * `viewer` rides along instead of a second `gh api user` call, which is why the
 * reviews are filtered here rather than by GitHub — the login is not known until
 * the same response carrying them arrives. `last: 50` is the right end of the
 * list: what matters is the most recent review you left, not the first.
 *
 * A partial answer is salvaged. GitHub reports a single unresolvable alias as an
 * error over an otherwise complete body, and `gh` exits non-zero with that body
 * still on stdout; throwing the whole batch away because one pull request was
 * deleted would strand every other draft in the repository as unchecked.
 */
export async function readLivePulls(repoDir: string, numbers: number[]): Promise<Map<number, LivePull> | null> {
  if (!numbers.length || !existsSync(repoDir)) return null

  let nameWithOwner: string
  try {
    nameWithOwner = JSON.parse(await gh(repoDir, ['repo', 'view', '--json', 'nameWithOwner']))?.nameWithOwner ?? ''
  } catch {
    return null
  }

  const [owner = '', name = ''] = nameWithOwner.split('/')
  if (!owner || !name) return null

  const aliases = numbers.map(n => `p${n}: pullRequest(number: ${n}) { ...D }`).join('\n')
  const query = `
    query($owner: String!, $name: String!) {
      viewer { login }
      repository(owner: $owner, name: $name) {
        ${aliases}
      }
    }
    fragment D on PullRequest {
      number
      state
      headRefOid
      reviews(last: 50) { nodes { submittedAt author { login } } }
    }
  `

  let raw: string
  try {
    raw = await gh(repoDir, [
      'api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`,
    ], 45_000)
  } catch (e: any) {
    raw = typeof e?.stdout === 'string' ? e.stdout : ''
    if (!raw.trim()) return null
  }

  let parsed: GraphqlAnswer
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const viewer = parsed.data?.viewer?.login
  const nodes = parsed.data?.repository
  // No viewer means the response is not one this can read, and treating every
  // pull request as never-reviewed-by-you would retire nothing and hide the
  // reason. Unchecked is the honest answer.
  if (!viewer || !nodes) return null

  const out = new Map<number, LivePull>()

  for (const node of Object.values(nodes)) {
    if (!node || typeof node.number !== 'number') continue

    const mine = (node.reviews?.nodes ?? [])
      // A review still being drafted on GitHub has no `submittedAt`. It has not
      // been sent either, so it is not evidence that this one has.
      .filter(r => r?.submittedAt && r.author?.login === viewer)
      .map(r => Date.parse(r.submittedAt!))
      .filter(t => Number.isFinite(t))

    out.set(node.number, {
      number: node.number,
      state: (node.state ?? '').toUpperCase(),
      headRefOid: node.headRefOid ?? '',
      reviewedByYouAt: mine.length ? Math.max(...mine) : null,
    })
  }

  return out
}

/**
 * A minute's memory, so walking into Land and back out does not re-ask.
 *
 * Short on purpose. The durable half of the saving is the retirement written to
 * the store — this only covers the drafts that are still genuinely live, and
 * those are the ones whose answer is allowed to change while you watch.
 */
const CACHE_MS = 60_000
const recent = new Map<string, { at: number; pulls: Map<number, LivePull> }>()

/** Test seam. The cache is module state and would otherwise outlive a case. */
export function forgetLivePulls(): void {
  recent.clear()
}

async function livePulls(repoDir: string, numbers: number[], now: number): Promise<Map<number, LivePull> | null> {
  const hit = recent.get(repoDir)
  if (hit && now - hit.at < CACHE_MS && numbers.every(n => hit.pulls.has(n))) return hit.pulls

  const pulls = await readLivePulls(repoDir, numbers)
  if (pulls) recent.set(repoDir, { at: now, pulls })
  return pulls
}

export interface RetireResult {
  /** Still waiting to be sent, as far as GitHub knows. */
  live: ReviewDraft[]
  /** Retired by this pass, each carrying the reason it was. */
  retired: ReviewDraft[]
  /** Drafts GitHub could not be asked about, and so were left alone and listed. */
  unchecked: number
}

/**
 * Ask GitHub about every live draft, retire the ones it has answers for.
 *
 * Grouped by repository because that is what one query covers, and because a
 * machine with four projects on it should cost four round trips rather than
 * one per review. A repository that cannot be reached takes only its own drafts
 * down with it — the rest are still checked.
 */
export async function retireStale(
  pairs: { draft: ReviewDraft; repoDir: string }[],
  now = Date.now(),
): Promise<RetireResult> {
  const byRepo = new Map<string, { draft: ReviewDraft; repoDir: string }[]>()
  for (const pair of pairs) {
    const held = byRepo.get(pair.repoDir)
    if (held) held.push(pair)
    else byRepo.set(pair.repoDir, [pair])
  }

  const readings = await Promise.all(
    [...byRepo.entries()].map(async ([repoDir, held]) => ({
      repoDir,
      pulls: await livePulls(repoDir, [...new Set(held.map(p => p.draft.pr))], now),
    })),
  )

  const pulls = new Map(readings.map(r => [r.repoDir, r.pulls]))

  const live: ReviewDraft[] = []
  const retired: ReviewDraft[] = []
  let unchecked = 0

  for (const { draft, repoDir } of pairs) {
    const reading = pulls.get(repoDir)
    const pull = reading?.get(draft.pr)

    if (!pull) {
      unchecked++
      live.push(draft)
      continue
    }

    const retirement = retirementFor(draft, pull, now)
    if (retirement) retired.push({ ...draft, retired: retirement })
    else live.push(draft)
  }

  if (retired.length) {
    const byId = new Map(retired.map(d => [d.sessionId, d.retired!]))
    await reviewDraftStore.update((file) => {
      for (const stored of file.drafts) {
        const retirement = byId.get(stored.sessionId)
        // Re-read inside the lock, so a review sent between the question and
        // the answer keeps its record rather than being overwritten by a
        // verdict taken before it existed.
        if (retirement && !stored.posted && !stored.retired) stored.retired = retirement
      }
    })
  }

  return { live, retired, unchecked }
}
