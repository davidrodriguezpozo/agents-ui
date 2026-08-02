/**
 * Pull a human-readable message out of whatever a failed request threw.
 *
 * Errors reach the client in several shapes: `createError({ message })` lands on
 * `data.message`, `createError({ data: { message } })` lands on
 * `data.data.message`, and a transport failure only has `Error.message` — which
 * for ofetch reads `[POST] "/api/x": 500 Internal Server Error`. That string is
 * noise to anyone who is not debugging, so it never reaches the UI.
 */

/**
 * ofetch's own message format, which is useless to a person. Covers both a
 * status code (`: 500 Internal Server Error`) and no response at all
 * (`: <no response> Failed to fetch`).
 */
const OFETCH_NOISE = /^\[\w+\]\s*["']?.*?["']?:\s*(<[^>]*>|\d{3})/i

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !OFETCH_NOISE.test(value.trim())
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error) return fallback
  if (usable(error)) return error.trim()

  const candidate = error as {
    data?: { message?: unknown; data?: { message?: unknown }; statusMessage?: unknown }
    statusMessage?: unknown
    message?: unknown
  }

  const layered = [
    candidate.data?.data?.message,
    candidate.data?.message,
    candidate.data?.statusMessage,
    candidate.statusMessage,
    candidate.message,
  ]

  for (const value of layered) {
    if (usable(value)) return value.trim()
  }

  return fallback
}

/** Machine-readable code when the server sent one, e.g. `cli_not_found`. */
export function errorCode(error: unknown): string | null {
  const candidate = error as { data?: { data?: { error?: unknown }; error?: unknown } }
  const code = candidate?.data?.data?.error ?? candidate?.data?.error
  return typeof code === 'string' ? code : null
}

/** True when the request never reached the server — it is probably not running. */
export function isOffline(error: unknown): boolean {
  const message = (error as { message?: unknown })?.message
  if (typeof message !== 'string') return false
  return /fetch failed|network|ECONNREFUSED|Failed to fetch|Load failed/i.test(message)
}
