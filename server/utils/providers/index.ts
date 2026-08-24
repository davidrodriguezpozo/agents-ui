import { claudeProvider } from './claude'
import { cursorProvider } from './cursor'
import { DEFAULT_PROVIDER, type Provider, type ProviderCapabilities, type ProviderId } from './types'

/**
 * Which agents this app can run a turn through.
 *
 * One map, so "what providers are there" has a single answer that the run
 * loop, the health endpoint and the session picker all read. Adding Codex is
 * adding a file and a line here.
 */
const PROVIDERS: Record<ProviderId, Provider> = {
  claude: claudeProvider,
  cursor: cursorProvider,
}

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[]

/**
 * The provider a record belongs to.
 *
 * **Absent means Claude Code**, and an unrecognised value does too. Every record
 * already on disk was written before this field existed and every one of them
 * ran on Claude Code, so absence already carries the answer — and a record
 * naming a provider this build has dropped is better read as the original than
 * as a crash.
 */
export function providerFor(id?: string | null): Provider {
  return PROVIDERS[id as ProviderId] ?? PROVIDERS[DEFAULT_PROVIDER]
}

/** Narrowed, for the endpoints that accept one from a request body. */
export function asProviderId(value: unknown): ProviderId | undefined {
  return typeof value === 'string' && value in PROVIDERS ? value as ProviderId : undefined
}

export function capabilitiesOf(id?: string | null): ProviderCapabilities {
  return providerFor(id).capabilities
}

export { DEFAULT_PROVIDER }
export type { Provider, ProviderCapabilities, ProviderId }
