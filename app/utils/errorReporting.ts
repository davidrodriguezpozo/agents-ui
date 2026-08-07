import { errorMessage, isOffline } from './errors'

/**
 * Deciding whether a failure nobody caught is worth saying out loud.
 *
 * Every bug found by hand in this app has been the same shape: something went
 * wrong where nobody could see it. A remove button whose request threw left the
 * row exactly where it was and said nothing, which is indistinguishable from a
 * button that was never wired up — and unreportable, because there is nothing
 * to report beyond "it didn't work".
 *
 * The cause is structural rather than careless. A composable lets its errors
 * propagate, which is right; the component is supposed to catch them. Miss one
 * and the failure evaporates, and no amount of reading catches every case. So
 * rather than guard eighty call sites and hope, anything that reaches the top
 * uncaught is shown.
 *
 * That only works if it stays quiet about things that are not failures.
 */

/**
 * Rejections that mean "as intended".
 *
 * Aborts are the big one: this app cancels in-flight streams constantly — every
 * navigation away from a session aborts its run stream — and each of those
 * rejects. Reporting them would put an error on screen for using the app
 * correctly, and would train everyone to ignore the thing entirely.
 */
export function isExpected(error: unknown): boolean {
  if (!error) return true

  const name = (error as { name?: unknown })?.name
  if (name === 'AbortError' || name === 'NavigationDuplicated') return true

  const message = (error as { message?: unknown })?.message
  if (typeof message === 'string' && /abort|cancell?ed|signal is aborted/i.test(message)) return true

  return false
}

export interface Report {
  title: string
  description: string
}

/**
 * What to show, or null to stay quiet.
 *
 * The server being gone is worth its own words: for a local app that is nearly
 * always "you stopped it in the terminal", and "Something went wrong" would
 * send someone looking for a bug that does not exist.
 */
export function describeFailure(error: unknown): Report | null {
  if (isExpected(error)) return null

  if (isOffline(error)) {
    return {
      title: 'Lost the app server',
      description: 'Nothing reached it. If it is still starting up, this will sort itself out.',
    }
  }

  return {
    title: 'Something failed quietly',
    description: errorMessage(error),
  }
}

/**
 * Suppress a repeat of the same thing.
 *
 * One broken poll is one broken poll every few seconds, and a stack of
 * identical toasts buries whatever else is on screen. Keyed on the message, so
 * two genuinely different failures still both get through.
 */
export function createDeduper(windowMs = 8000) {
  const seen = new Map<string, number>()

  return function shouldReport(key: string, now: number): boolean {
    const last = seen.get(key)
    if (last !== undefined && now - last < windowMs) return false

    seen.set(key, now)

    // Bounded: this lives for the lifetime of the tab.
    if (seen.size > 50) {
      for (const [k, at] of seen) {
        if (now - at >= windowMs) seen.delete(k)
      }
    }

    return true
  }
}
