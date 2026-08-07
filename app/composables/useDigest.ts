import { errorMessage } from '~/utils/errors'

export type RitualOutcome = 'ok' | 'blocked' | 'failed' | 'stopped' | 'running'

export interface DigestRitual {
  scheduleId: string
  title: string
  outcome: RitualOutcome
  at: number
  costUsd?: number
  preview: string
  problem?: string
  /** Rules that would have let a blocked run through. */
  suggestedRules?: string[]
  /** Blocked at the time, but the rules it needed have since been granted. */
  alreadyAllowed?: boolean
}

export interface DigestSession {
  id: string
  title: string
  summary?: string
  check?: 'passing' | 'failing' | 'errored' | 'running'
  behindBase: boolean
  state: 'needs-you' | 'ready' | 'working' | 'nothing-yet'
}

export interface Digest {
  since: number
  quiet: boolean
  rituals: DigestRitual[]
  sessions: DigestSession[]
  stopped: { id: string; title: string; reason: string }[]
  costUsd: number
  needsYou: number
}

/**
 * What happened while you were away.
 *
 * Fetched once when the page opens rather than polled. This is a report on a
 * window that has already closed — re-asking every few seconds would be asking
 * the same question about the same past.
 */
export function useDigest() {
  const digest = useState<Digest | null>('digest', () => null)
  const loading = useState('digest-loading', () => false)
  const error = useState<string | null>('digest-error', () => null)

  async function load(since?: number) {
    loading.value = true
    error.value = null
    try {
      digest.value = await $fetch<Digest>('/api/digest', {
        query: since ? { since } : undefined,
      })
    } catch (e) {
      error.value = errorMessage(e, 'Could not work out what happened.')
    } finally {
      loading.value = false
    }
  }

  return { digest, loading, error, load }
}
