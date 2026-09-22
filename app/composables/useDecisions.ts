/**
 * Mirrors `Decision` in `server/utils/decisions.ts`, which is the authority —
 * only as far as the queue reads it. The alternatives are deliberately here:
 * a row that asks why you chose something has to be able to show what the other
 * options were, or it is asking a question with no context in it.
 */
export interface DecisionAlternative {
  what: string
  detail?: string
  chosen?: true
}

export type DecisionSource = 'ask_user_question' | 'denied' | 'steer' | 'marker'

export interface Decision {
  id: string
  sessionId: string
  at: number
  source: DecisionSource
  what: string
  alternatives: DecisionAlternative[]
  reason?: string
  files: string[]
  runId?: string
}

/** One session's unanswered decisions — see `unansweredReasons` on the server. */
export interface UnansweredSession {
  sessionId: string
  title: string
  decisions: Decision[]
}

/**
 * Decisions waiting on a reason.
 *
 * Fetched on demand rather than polled: unlike the attention count, nothing
 * about this changes while you are looking at it except by your own hand, and
 * a *why* is the one row on the queue that is never urgent. It is worth asking
 * for while the answer is still true — see `WHY_WINDOW_MS` — and never worth
 * interrupting anybody over.
 */
export function useDecisions() {
  const sessions = useState<UnansweredSession[]>('decision-why', () => [])
  const loading = useState<boolean>('decision-why-loading', () => false)
  /**
   * What delivery last had to say for itself — most usefully, that no Slack is
   * set up and the records are staying here. Said once, on the one surface a
   * decision would otherwise have reached somebody through.
   */
  const notice = useState<{ at: number; message: string } | null>('decision-notice', () => null)

  async function load() {
    loading.value = true
    try {
      const result = await $fetch<{
        sessions: UnansweredSession[]
        notice?: { at: number; message: string }
      }>('/api/decisions')
      sessions.value = result.sessions
      notice.value = result.notice ?? null
    } catch {
      // A queue that could not be read shows nothing rather than an error: it
      // sits under rows that are genuinely blocking somebody, and a red line
      // about an unanswered "why" would outrank them by accident.
      sessions.value = []
      notice.value = null
    } finally {
      loading.value = false
    }
  }

  /**
   * Save one reason and drop it from the list, so the row shrinks by one line
   * as it is answered rather than after a round trip that re-reads everything.
   */
  async function say(decisionId: string, reason: string): Promise<boolean> {
    try {
      await $fetch(`/api/decisions/${decisionId}`, { method: 'PUT', body: { reason } })
    } catch {
      return false
    }

    sessions.value = sessions.value
      .map(session => ({
        ...session,
        decisions: session.decisions.filter(d => d.id !== decisionId),
      }))
      .filter(session => session.decisions.length > 0)

    return true
  }

  return { sessions, notice, loading, load, say }
}
