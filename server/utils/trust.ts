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

export const DEFAULT_TRUST: TrustLevel = 'edits'

export function permissionModeFor(trust: TrustLevel | undefined): SdkPermissionMode {
  if (trust === 'readonly') return 'plan'
  if (trust === 'full') return 'bypassPermissions'
  return 'acceptEdits'
}

/** Anything above this asks for nothing, which is worth saying out loud. */
export function asksNothing(trust: TrustLevel | undefined): boolean {
  return trust === 'full'
}
