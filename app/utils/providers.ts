/**
 * Which agent ran it, for the surfaces that show a turn.
 *
 * The browser's half of `server/utils/providers/`. Deliberately a table of
 * labels and icons and nothing else: what a provider *can do* is answered by
 * the server, which reads it off the provider itself, and a second copy of that
 * here is the copy that would drift.
 */

export type ProviderName = 'claude' | 'cursor'

export interface ProviderLook {
  label: string
  icon: string
}

const LOOK: Record<ProviderName, ProviderLook> = {
  claude: { label: 'Claude Code', icon: 'i-lucide-sparkles' },
  cursor: { label: 'Cursor', icon: 'i-lucide-mouse-pointer-2' },
}

/** Absent, empty and unrecognised all mean Claude Code — see `providerFor`. */
export function providerLook(provider?: string | null): ProviderLook {
  return LOOK[provider as ProviderName] ?? LOOK.claude
}

export function providerLabel(provider?: string | null): string {
  return providerLook(provider).label
}

/**
 * Whether a row should carry a badge at all.
 *
 * False for Claude Code, including the absence that means it. On a machine that
 * only ever used one agent, a badge on every row saying so is a column that is
 * the same on every row of every list — which this codebase's own rule about
 * tables says is worse than no column. What is worth a glance is the row that
 * is *different*, so that is the only one marked.
 *
 * A detail view is the other case and does not use this: there the question
 * "what ran this" is being asked directly, and the answer is always worth
 * giving. See `RunHeader`.
 */
export function marksProvider(provider?: string | null): boolean {
  return Boolean(provider) && provider !== 'claude' && (provider as ProviderName) in LOOK
}
