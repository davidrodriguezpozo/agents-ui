/**
 * How much a run is trusted to do without stopping to ask.
 *
 * Shared by rituals and sessions because it is the same question asked at
 * different moments: a ritual decides once, when nobody will be there at 8am,
 * and a session decides now, with you watching. The vocabulary should not
 * differ just because the timing does.
 */
export type TrustLevel = 'readonly' | 'edits' | 'full'

/** The SDK's own permission modes, which these map onto. */
export type SdkPermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions'

/**
 * What a session that never said runs as: **Auto**.
 *
 * This applies to sessions and not to rituals, and the difference is not a
 * subtlety — it is why the change is safe to make at all. A ritual always
 * carries an explicit `permission` (see `schedules.ts`, where it defaults to
 * `edits` on the way in), so `permissionModeFor` never sees `undefined` on that
 * path. A session frequently has no recorded trust: one started from a pull
 * request row, from the Fleet screen, or by anything else that had no picker to
 * offer.
 *
 * Those were the sessions that stopped to ask. Every one of them lives in its own
 * worktree, and the reason Auto is the right default there is the reason the
 * hint beside it gives: nothing in a throwaway checkout is worth a prompt. What
 * remains in the way of a run is the project's sandbox, which is a boundary
 * about *where* it can reach rather than a question put to a person, and which
 * an Auto run has never been able to cross.
 *
 * The cost, stated plainly because it is real: a session will not stop to ask
 * again, so "needs you" on the Fleet screen and the Now queue will be about
 * rituals and pull requests rather than about sessions. Set a session to Plan
 * only or Edit files to get the questions back.
 */
export const DEFAULT_TRUST: TrustLevel = 'full'

export function permissionModeFor(trust: TrustLevel | undefined): SdkPermissionMode {
  // Resolved through the constant rather than by falling through to a literal,
  // so there is one place where "it never said" is answered and the page and the
  // run cannot come to different conclusions about the same session.
  const level = trust ?? DEFAULT_TRUST

  if (level === 'readonly') return 'plan'
  if (level === 'full') return 'bypassPermissions'
  return 'acceptEdits'
}

/** Anything above this asks for nothing, which is worth saying out loud. */
export function asksNothing(trust: TrustLevel | undefined): boolean {
  return (trust ?? DEFAULT_TRUST) === 'full'
}
