import { INBOX_SOURCES, inboxStore, visibleItems } from '../../utils/inbox'

/**
 * What is waiting for you elsewhere, as last found.
 *
 * Reads the store and nothing else, so opening Now costs nothing. Finding these
 * is a two-minute job — see `refresh.post.ts` — and the whole point of writing
 * the findings down is that the queue never waits for it.
 */
export default defineEventHandler(async () => {
  const inbox = await inboxStore.read()

  return {
    sources: INBOX_SOURCES.map((source) => {
      const state = inbox.sources.find(s => s.source === source.key)
      return {
        key: source.key,
        label: source.label,
        requires: source.requires,
        icon: source.icon,
        items: visibleItems(state),
        checkedAt: state?.checkedAt,
        costUsd: state?.costUsd,
        durationMs: state?.durationMs,
        error: state?.error,
        projectDir: state?.projectDir,
        refreshAt: state?.refreshAt,
      }
    }),
  }
})
