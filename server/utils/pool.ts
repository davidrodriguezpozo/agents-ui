/**
 * Doing many things at once without doing all of them at once.
 *
 * Every fan-out here started life as `Promise.all` over a list, which is right
 * for a list of files and ruinous for a list of subprocesses. Forty-five
 * sessions across five repositories is two hundred and fifty-odd `git`
 * invocations, and starting them simultaneously does not finish them sooner:
 * they contend for the same disk and the same process table, and the server
 * that spawned them answers nothing else until they drain. Opening one session
 * page took seven seconds to load a conversation that takes a tenth of one.
 */

/**
 * `Promise.all(items.map(fn))` with a ceiling on how many run at once.
 *
 * Order of results follows `items`, not completion, so callers can zip the
 * output back against the input. Rejection behaves as `Promise.all` does — the
 * first failure rejects — because every call site here already relied on that.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index]!, index)
    }
  }

  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: workers }, worker))

  return results
}

/**
 * One computation shared by everyone who asks for it while it is running.
 *
 * Two requests wanting the same expensive answer at the same moment should cost
 * what one costs. Nothing is remembered once it settles — that is a cache, and
 * a different decision with different staleness to answer for; this only stops
 * the same work being started twice over.
 */
export function inFlight<K, R>(): (key: K, compute: () => Promise<R>) => Promise<R> {
  const running = new Map<K, Promise<R>>()

  return function share(key, compute) {
    const existing = running.get(key)
    if (existing) return existing

    // Registered before anything can await it, so a caller arriving in the same
    // tick joins rather than starting a second copy.
    const promise = compute().finally(() => { running.delete(key) })
    running.set(key, promise)

    return promise
  }
}
