import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Where a finding can actually be posted.
 *
 * This is the part that decides whether a review composer works or is
 * abandoned. GitHub will only take an inline review comment on a line that is
 * *in the diff*: anything else is a 422 for the whole review, not for the one
 * comment — so a single mis-anchored finding loses the other seven.
 *
 * We are in an unusually good position to get it right. A review session has
 * the pull request's head commit checked out in a workspace this app owns, so
 * every anchor can be checked against the real diff locally, before GitHub is
 * asked anything. Nothing is guessed and nothing is sent hopefully.
 *
 * Three outcomes, and the pane shows which is which:
 *
 *   - `inline` — the line is in the diff. Posts where the reviewer pointed.
 *   - `file` — the file is in the diff, the line is not. The reviewer's point is
 *     about code this pull request did not touch, which is a real thing to say
 *     about a diff; it posts against the file rather than being nudged onto the
 *     nearest changed line, because a comment on the wrong line is worse than a
 *     comment on no line.
 *   - `summary` — no file at all, a file the diff never touched, or a name that
 *     could be two of them. Folded into the review body, *visibly*. Silent
 *     truncation is the failure this whole feature exists to avoid: a review
 *     that quietly dropped its architectural finding reads as a review that did
 *     not have one.
 *
 * A location is resolved against the diff before any of that — reports name
 * files the way a person does, and the diff is keyed from the repository root.
 * See `resolvePath`.
 */

export type AnchorKind = 'inline' | 'file' | 'summary'

export interface Anchor {
  kind: AnchorKind
  path?: string
  line?: number
  /** `RIGHT` is the head of the pull request; `LEFT` is its base. */
  side?: 'RIGHT' | 'LEFT'
  /** Why it is not inline, in a sentence somebody reads. */
  reason?: string
}

/** The lines a diff makes commentable, per file. */
export interface DiffPositions {
  /** Lines added or changed — the head side. */
  right: Map<string, Set<number>>
  /** Lines removed — the base side. */
  left: Map<string, Set<number>>
  /** Every file the diff touched, including pure deletes and renames. */
  files: Set<string>
}

async function git(cwd: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout, maxBuffer: 20 * 1024 * 1024 })
  return stdout
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Which lines of which files this diff makes commentable.
 *
 * `--unified=0` on purpose: with context lines, a hunk header covers lines the
 * diff did not change, and GitHub refuses a comment on those. Reading the
 * ranges from a zero-context diff gives exactly the set it will accept.
 *
 * The three-dot range is the same one the review prompt tells the agent to read
 * (`git diff base...HEAD`), so the anchors and the review are looking at the
 * same diff. Two dots would include everything that landed on the base branch
 * since the pull request was cut, and findings would anchor onto other people's
 * changes.
 */
export async function diffPositions(cwd: string, baseRef: string): Promise<DiffPositions> {
  const out: DiffPositions = { right: new Map(), left: new Map(), files: new Set() }

  const raw = await git(cwd, ['diff', '--unified=0', '--no-color', `${baseRef}...HEAD`])

  // The two sides are tracked separately, because they are not always the same
  // file. A delete has `+++ /dev/null`, a create has `--- /dev/null`, and a
  // rename has two different names — reading both from the `+++` line lost the
  // base-side lines of every deleted file, which is the one case where the only
  // thing there is to comment on is what was removed.
  let leftPath: string | null = null
  let rightPath: string | null = null

  for (const line of raw.split('\n')) {
    if (line.startsWith('--- ')) {
      const named = line.slice(4).trim()
      leftPath = named === '/dev/null' ? null : named.replace(/^a\//, '')
      if (leftPath) out.files.add(leftPath)
      continue
    }

    if (line.startsWith('+++ ')) {
      const named = line.slice(4).trim()
      rightPath = named === '/dev/null' ? null : named.replace(/^b\//, '')
      if (rightPath) out.files.add(rightPath)
      continue
    }

    const hunk = line.match(HUNK)
    if (!hunk) continue

    const leftStart = Number(hunk[1])
    // An absent count means one line; a count of zero means the hunk inserts or
    // deletes *at* that position rather than covering it, and has no lines of
    // its own on that side.
    const leftCount = hunk[2] === undefined ? 1 : Number(hunk[2])
    const rightStart = Number(hunk[3])
    const rightCount = hunk[4] === undefined ? 1 : Number(hunk[4])

    if (rightCount > 0 && rightPath) {
      const set = out.right.get(rightPath) ?? new Set<number>()
      for (let i = 0; i < rightCount; i++) set.add(rightStart + i)
      out.right.set(rightPath, set)
    }

    if (leftCount > 0 && leftPath) {
      const set = out.left.get(leftPath) ?? new Set<number>()
      for (let i = 0; i < leftCount; i++) set.add(leftStart + i)
      out.left.set(leftPath, set)
    }
  }

  return out
}

/** What a location's path turned out to name, once checked against the diff. */
export interface Resolved {
  /** The repository-relative path, when exactly one file in the diff is it. */
  path?: string
  /** Set when more than one file could be meant, which is not a resolution. */
  ambiguous?: string
}

/**
 * The repository-relative path a finding's location meant.
 *
 * Reports name files the way a person reading them does — `email-collector.ts`,
 * or `hooks/api/dashboard.ts` — while the diff is keyed from the repository
 * root. An exact lookup therefore missed every finding in a repository with any
 * depth to it: in the drafts this was found in, *every* anchor that resolved had
 * a full path and not one bare filename ever did, so reviews of a monorepo
 * folded entirely into the summary and the send button offered nought comments.
 *
 * So a path that is not in the diff is tried as a suffix of one. This is not the
 * guessing the rest of this file refuses: a single file ending in `/<named>` is
 * the file that was meant, and it is checked rather than assumed. Two would be a
 * guess, so two stays in the summary and says which ones — the reviewer can see
 * that their location was the ambiguous half.
 */
export function resolvePath(named: string, positions: DiffPositions): Resolved {
  if (positions.files.has(named)) return { path: named }

  // Anchored on a segment boundary, so `collector.ts` cannot claim
  // `email-collector.ts` and `api/dashboard.ts` cannot claim `internal-api/dashboard.ts`.
  const suffix = `/${named}`
  const matches = [...positions.files].filter(file => file.endsWith(suffix))

  if (matches.length === 1) return { path: matches[0]! }
  if (matches.length > 1) {
    return {
      ambiguous: `${named} matches ${matches.length} files in this diff (${matches.slice(0, 3).join(', ')}${matches.length > 3 ? ', …' : ''})`,
    }
  }

  return {}
}

/**
 * Where one finding goes.
 *
 * The head side is tried first because that is what a review is almost always
 * about — the code as it will be after merging. A finding on a line the diff
 * only *removed* is a real thing to say ("you deleted the guard"), and it
 * anchors to the base side rather than being pushed into the summary.
 */
export function anchorFor(
  finding: { path?: string; line?: number; location: string },
  positions: DiffPositions,
): Anchor {
  if (!finding.path) {
    return {
      kind: 'summary',
      reason: finding.location
        ? `"${finding.location}" is not a file and a line`
        : 'the finding named no location',
    }
  }

  const resolved = resolvePath(finding.path, positions)

  if (!resolved.path) {
    return {
      kind: 'summary',
      path: finding.path,
      reason: resolved.ambiguous ?? `${finding.path} is not in this diff`,
    }
  }

  const path = resolved.path

  if (finding.line === undefined) {
    return { kind: 'file', path, reason: 'the finding is about the file rather than a line' }
  }

  if (positions.right.get(path)?.has(finding.line)) {
    return { kind: 'inline', path, line: finding.line, side: 'RIGHT' }
  }

  if (positions.left.get(path)?.has(finding.line)) {
    return { kind: 'inline', path, line: finding.line, side: 'LEFT' }
  }

  return {
    kind: 'file',
    path,
    reason: `line ${finding.line} of ${path} is not in this diff`,
  }
}

/**
 * A sentence about what could not be posted where it was aimed.
 *
 * Appended to the review body when anything degraded, because the alternative
 * is a review that silently said less than the reviewer did. Says what and
 * where rather than only how many: "one finding was moved" is not something the
 * author can check.
 */
export function describeDegraded(
  entries: { location: string; anchor: Anchor }[],
): string | null {
  const moved = entries.filter(e => e.anchor.kind !== 'inline')
  if (!moved.length) return null

  const lines = moved.map((e) => {
    const where = e.anchor.kind === 'file' ? 'posted against the file' : 'included here'
    return `- \`${e.location || 'unlocated'}\` — ${where}: ${e.anchor.reason ?? 'not in the diff'}`
  })

  return [
    moved.length === 1
      ? 'One finding could not be attached to a line in this diff:'
      : `${moved.length} findings could not be attached to a line in this diff:`,
    '',
    ...lines,
  ].join('\n')
}

/**
 * A base ref the workspace can actually diff against.
 *
 * The review prompt tells the agent to read `git diff <baseBranch>...HEAD`, so
 * the same ref is what the anchors should be computed from — being consistent
 * with the review matters more than being clever, since a review taken against
 * one diff and anchored against another would put real comments on lines the
 * reviewer never looked at.
 *
 * It still needs a fallback, because a detached worktree has no guarantee of a
 * *local* branch by that name: a pull request based on a colleague's branch is
 * often only ever a remote-tracking ref here. Tried in order of how close each
 * is to what the review saw, and the branch name is returned unchanged when
 * none of them resolve — git's own error about an unknown revision is clearer
 * than anything invented here.
 */
export async function resolveBaseRef(cwd: string, baseBranch: string): Promise<string> {
  const candidates = [baseBranch, `origin/${baseBranch}`, `upstream/${baseBranch}`]

  for (const ref of candidates) {
    try {
      await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], 10_000)
      return ref
    } catch {
      // Not this one.
    }
  }

  return baseBranch
}
