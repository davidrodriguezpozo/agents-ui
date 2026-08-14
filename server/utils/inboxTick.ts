import { dueForRefresh, inboxStore } from './inbox'
import { refreshInboxSource } from './inboxRefresh'

/** Sources with a refresh in flight, so a slow one cannot stack up. */
const inFlight = new Set<string>()

/**
 * The daily look, for sources that were told to.
 *
 * Rides the scheduler's existing tick rather than owning a timer, because the
 * question "is anything due" is a file read and does not deserve one.
 *
 * Nothing here decides to spend money on its own: `dueForRefresh` is false
 * unless somebody set a time, and it stays false until the source has run once
 * by hand — a source with no recorded project directory has never been proven to
 * work, and automating something unproven is how you get a daily failure nobody
 * reads. The ceiling is one refresh per source per day, which at measured cost is
 * about $0.38.
 *
 * A failure is written where the last error already shows, on the source's own
 * row in the queue. It is deliberately not a toast or a notification: you did not
 * ask for this one, so being told about it can wait until you look.
 */
export async function tickInbox(now = Date.now()): Promise<void> {
  const inbox = await inboxStore.read().catch(() => null)
  if (!inbox) return

  const due = inbox.sources.filter(state =>
    dueForRefresh(state, now) && !inFlight.has(state.source))

  for (const state of due) {
    inFlight.add(state.source)
    try {
      const result = await refreshInboxSource(state.source, state.projectDir)

      if (!result.ok) {
        // A refusal costs nothing, but silently doing nothing every morning
        // would look identical to an empty inbox. Record it where it shows.
        await inboxStore.update((current) => {
          const target = current.sources.find(s => s.source === state.source)
          if (target) {
            target.error = result.refusal.message
            target.checkedAt = Date.now()
          }
        })
        console.log(`[inbox] ${state.source} skipped: ${result.refusal.error}`)
        continue
      }

      const cost = result.state.costUsd
      console.log(
        `[inbox] ${state.source} refreshed: ${result.state.items.length} waiting`
        + (cost ? `, $${cost.toFixed(2)}` : ''),
      )
    } catch (e: any) {
      // Never let one source take down the tick that other rituals ride on.
      console.log(`[inbox] ${state.source} failed: ${e?.message ?? e}`)
    } finally {
      inFlight.delete(state.source)
    }
  }
}
