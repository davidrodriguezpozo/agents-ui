import type { TokenUsage } from '~/types'

/**
 * The four token counts, pulled off an SDK result message.
 *
 * Both the detached runner and the Studio's chat need these, and both used to
 * read them by casting the message to `Record<string, number>`. That stopped
 * being true: `usage.cache_creation` is now an object breaking the five-minute
 * and one-hour caches apart, so the whole record is no longer numbers and the
 * cast no longer compiles.
 *
 * The four fields read here are still plain numbers, which is the only claim
 * this makes — and it makes it in one place, so the next shape change is one
 * edit rather than two.
 */
type ResultUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function tokenUsageOf(message: unknown): TokenUsage {
  const usage = (message as { usage?: ResultUsage } | null)?.usage ?? {}
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
  }
}
