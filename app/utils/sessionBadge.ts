import type { SessionActivity, SessionCheck } from '~/composables/useSessions'

/**
 * The one thing a session row asserts, and the thing most often wrong.
 *
 * This has told three separate lies. It called a session "idle" when it had
 * written twelve files and was waiting to be merged. It showed green over a row
 * that also said "17 behind". And it stayed green while the page underneath it
 * said the result was incomplete. Each was a case of the badge describing the
 * session rather than the result, or asserting something nobody had checked.
 *
 * So the decision lives here, in one tested place, rather than inside a
 * template where it can only be verified by looking at it.
 *
 * The rule it now follows: green is a claim that this work is good and ready.
 * Anything that makes the claim untrue — or merely unverified — is not green.
 */

/**
 * The glyph a dense row draws instead of the pill.
 *
 * A list of forty sessions cannot spend 90px of every row on the words
 * "Passed, then changed" — and it does not need to, because the reader is
 * scanning for the one row that is not fine. So the row draws a 14px mark in a
 * fixed leading column, every mark on the same vertical axis, and keeps the
 * words in the title attribute for the one row that earns a closer look.
 *
 * The shapes are a progression, not a set: an empty ring is nothing yet, a
 * part-filled ring is partly there, a full one is done. `failed` and `blocked`
 * break the progression on purpose — they are the two the eye must catch.
 */
export type BadgeShape =
  | 'empty'     // ring, dashed — nothing came of it
  | 'pending'   // ring, solid — work exists, nobody has judged it
  | 'progress'  // rotating arc — something is running right now
  | 'partial'   // part-filled ring — was good, no longer certain
  | 'done'      // filled ring — good and ready
  | 'failed'    // ring with a bar — it does not work
  | 'blocked'   // filled ring, pulsing — it is asking you something

export interface Badge {
  label: string
  icon: string
  /** A CSS variable or literal colour. */
  color: string
  background: string
  /** What a glyph-only row draws. See `BadgeShape`. */
  shape: BadgeShape
  spin?: boolean
  pulse?: boolean
}

export interface BadgeInput {
  activity: SessionActivity
  changedFiles?: number
  /**
   * Nobody counted the files.
   *
   * `changedFiles: undefined` is ambiguous — it is also what a session with
   * nothing in it looks like — and the wall is a caller that genuinely cannot
   * know: it is built without spawning git, on purpose, so asking how many files
   * moved is the one question it cannot afford. Without this it would read
   * "No changes" over a session that had written twelve, which is the same lie
   * this file was written to stop, arriving from the other direction.
   */
  changesUnknown?: boolean
  /** Only `status` is read, so a caller holding just that may pass just that. */
  check?: Pick<SessionCheck, 'status'> | null
  /** The recorded verdict predates the current contents of the workspace. */
  checkStale?: boolean
  /** Commits on the base branch this session does not have. */
  behind?: number
  /**
   * Its work is in the base branch already.
   *
   * Outranks everything below because it is the end of the story. A landed
   * session is still `behind` — by the very merge commit that landed it — so
   * without this it was labelled "Base moved on", which asserts there is work to
   * do about a session that is finished.
   */
  landed?: boolean
  /**
   * Its landed work has since been taken back out of the base branch.
   *
   * Outranks `landed` for the same reason `landed` outranks the verdicts: it is
   * the later fact about the same thing, and "Landed" over a merge that has been
   * reverted is this file's characteristic lie — a green claim nobody rechecked.
   *
   * Not red and not amber, though. A revert is regularly the right thing to have
   * happened, and nothing about it is waiting on the person reading the row.
   */
  reverted?: boolean
}

const ACCENT = { color: 'var(--accent)', background: 'var(--accent-muted)' }
/**
 * Derived from the tokens rather than restated. These were literals — a green
 * that was Tailwind's green-500 and matched neither `--success` in light mode
 * nor in dark — so a re-theme changed every other green in the app and left
 * the one on the session rows behind.
 */
const WARNING = { color: 'var(--warning)', background: 'var(--warning-tint)' }
const ERROR = { color: 'var(--error)', background: 'var(--error-tint)' }
const SUCCESS = { color: 'var(--success)', background: 'var(--success-tint)' }
const QUIET = { color: 'var(--text-disabled)', background: 'var(--badge-subtle-bg)' }

export function sessionBadge(input: BadgeInput): Badge {
  switch (input.activity) {
    case 'awaiting-permission':
      return { label: 'Needs you', icon: 'i-lucide-hand', ...ACCENT, shape: 'blocked', pulse: true }
    case 'working':
      return { label: 'Working', icon: 'i-lucide-loader-2', ...ACCENT, shape: 'progress', spin: true }
    case 'failed':
      return { label: 'Failed', icon: 'i-lucide-circle-alert', ...ERROR, shape: 'failed' }
    case 'missing':
      return { label: 'Workspace gone', icon: 'i-lucide-unlink', ...ERROR, shape: 'failed' }
  }

  // Only meaningful once nothing is running. Mid-turn, a verdict describes a
  // workspace that has already moved on.
  const check = input.check ?? null

  if (check?.status === 'running') {
    return { label: 'Checking', icon: 'i-lucide-loader-2', ...ACCENT, shape: 'progress', spin: true }
  }

  /**
   * Above the verdicts, not below them. Once the work is in the base, a local
   * pass or failure describes code that has already shipped — the fact worth
   * putting on the row is that it is in.
   */
  /**
   * Above `landed`, because it is the later news about the same merge. The
   * session's own branch is still contained in the base afterwards — a revert
   * adds a commit, it does not remove one — so nothing further down can tell.
   */
  if (input.reverted) {
    return { label: 'Landed, then reverted', icon: 'i-lucide-undo-2', ...QUIET, shape: 'partial' }
  }

  if (input.landed) {
    return { label: 'Landed', icon: 'i-lucide-git-merge', ...SUCCESS, shape: 'done' }
  }

  if (check?.status === 'failing') {
    return {
      label: input.checkStale ? 'Failed, then changed' : 'Checks failed',
      icon: 'i-lucide-circle-x',
      ...ERROR,
      shape: 'failed',
    }
  }

  // Deliberately not green: a check that could not run is not a pass, and
  // colouring it like one is the exact lie this exists to stop.
  if (check?.status === 'errored') {
    return { label: 'Checks did not run', icon: 'i-lucide-circle-help', ...WARNING, shape: 'partial' }
  }

  const hasWork = Boolean(input.changedFiles) || check?.status === 'passing'

  /**
   * The base has moved and this has not. Reported for anything with work in it,
   * whether or not checks ever ran, because the word both green labels use is
   * "ready" and this is the state in which it is least true.
   *
   * Git will refuse a textual conflict, but it has nothing to say about the
   * other branch renaming something this one calls — that merges cleanly and
   * then breaks. A passing check makes it worse rather than better: the pass
   * was earned against a base that no longer exists.
   */
  if (input.behind && hasWork) {
    return { label: 'Base moved on', icon: 'i-lucide-git-pull-request-arrow', ...WARNING, shape: 'partial' }
  }

  if (check?.status === 'passing') {
    if (input.checkStale) {
      return { label: 'Passed, then changed', icon: 'i-lucide-history', ...WARNING, shape: 'partial' }
    }

    return { label: 'Checks pass', icon: 'i-lucide-check-check', ...SUCCESS, shape: 'done' }
  }

  // No checks were ever run here, so nothing is being claimed about whether the
  // work is good — only that there is some, and that it still applies.
  if (input.changedFiles) {
    return { label: 'Changes ready', icon: 'i-lucide-check', ...SUCCESS, shape: 'pending' }
  }

  // Asserts nothing about the work, because nobody looked. See `changesUnknown`.
  if (input.changesUnknown) {
    return { label: 'Idle', icon: 'i-lucide-circle-dashed', ...QUIET, shape: 'empty' }
  }

  // Describes the result, not the session: one that thought about it and wrote
  // nothing is finished business, not something still to get round to.
  return { label: 'No changes', icon: 'i-lucide-circle-dashed', ...QUIET, shape: 'empty' }
}
