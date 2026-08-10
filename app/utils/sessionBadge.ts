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

export interface Badge {
  label: string
  icon: string
  /** A CSS variable or literal colour. */
  color: string
  background: string
  spin?: boolean
  pulse?: boolean
}

export interface BadgeInput {
  activity: SessionActivity
  changedFiles?: number
  check?: SessionCheck | null
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
}

const ACCENT = { color: 'var(--accent)', background: 'var(--accent-muted)' }
const WARNING = { color: 'var(--warning)', background: 'rgba(212, 153, 34, 0.12)' }
const ERROR = { color: 'var(--error)', background: 'rgba(248, 113, 113, 0.12)' }
const SUCCESS = { color: 'rgb(34, 197, 94)', background: 'rgba(34, 197, 94, 0.12)' }
const QUIET = { color: 'var(--text-disabled)', background: 'var(--badge-subtle-bg)' }

export function sessionBadge(input: BadgeInput): Badge {
  switch (input.activity) {
    case 'awaiting-permission':
      return { label: 'Needs you', icon: 'i-lucide-hand', ...ACCENT, pulse: true }
    case 'working':
      return { label: 'Working', icon: 'i-lucide-loader-2', ...ACCENT, spin: true }
    case 'failed':
      return { label: 'Failed', icon: 'i-lucide-circle-alert', ...ERROR }
    case 'missing':
      return { label: 'Workspace gone', icon: 'i-lucide-unlink', ...ERROR }
  }

  // Only meaningful once nothing is running. Mid-turn, a verdict describes a
  // workspace that has already moved on.
  const check = input.check ?? null

  if (check?.status === 'running') {
    return { label: 'Checking', icon: 'i-lucide-loader-2', ...ACCENT, spin: true }
  }

  /**
   * Above the verdicts, not below them. Once the work is in the base, a local
   * pass or failure describes code that has already shipped — the fact worth
   * putting on the row is that it is in.
   */
  if (input.landed) {
    return { label: 'Landed', icon: 'i-lucide-git-merge', ...SUCCESS }
  }

  if (check?.status === 'failing') {
    return {
      label: input.checkStale ? 'Failed, then changed' : 'Checks failed',
      icon: 'i-lucide-circle-x',
      ...ERROR,
    }
  }

  // Deliberately not green: a check that could not run is not a pass, and
  // colouring it like one is the exact lie this exists to stop.
  if (check?.status === 'errored') {
    return { label: 'Checks did not run', icon: 'i-lucide-circle-help', ...WARNING }
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
    return { label: 'Base moved on', icon: 'i-lucide-git-pull-request-arrow', ...WARNING }
  }

  if (check?.status === 'passing') {
    if (input.checkStale) {
      return { label: 'Passed, then changed', icon: 'i-lucide-history', ...WARNING }
    }

    return { label: 'Checks pass', icon: 'i-lucide-check-check', ...SUCCESS }
  }

  // No checks were ever run here, so nothing is being claimed about whether the
  // work is good — only that there is some, and that it still applies.
  if (input.changedFiles) {
    return { label: 'Changes ready', icon: 'i-lucide-check', ...SUCCESS }
  }

  // Describes the result, not the session: one that thought about it and wrote
  // nothing is finished business, not something still to get round to.
  return { label: 'No changes', icon: 'i-lucide-circle-dashed', ...QUIET }
}
