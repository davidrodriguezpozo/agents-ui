import { readPreferences } from './preferences'

/**
 * How much may run at once when nobody is watching.
 *
 * Nothing capped this. Ten rituals due at 08:00 started ten agents at the same
 * moment, each with its own model calls and its own shell, and any session
 * repairing itself joined them. The scheduler stopped a single ritual stacking
 * on itself and that was the whole of it.
 *
 * On a laptop asleep on a desk that is how you wake up to a hot machine, a
 * rate-limit wall, and six half-finished runs — the exact opposite of what
 * "leave it running" is supposed to buy you.
 *
 * The distinction the queue draws is not by kind of work but by whether anyone
 * is waiting for it. A turn you typed goes now: you are sitting there, and a
 * spinner that means "queued behind a ritual" is worse than a slow machine. A
 * ritual firing at 08:00, a session fixing its own tests, a workflow stepping
 * through its agents — none of those are being watched, and all of them can
 * wait ten seconds.
 */

let active = 0
const waiting: (() => void)[] = []

/**
 * Admissions, one at a time, in the order they arrived.
 *
 * Deciding in parallel was wrong in a way that only showed up under load:
 * every caller awaited its own read of the preference before looking at the
 * queue, so three runs starting together were admitted in whatever order those
 * three reads happened to finish. The ritual that had been waiting ten minutes
 * could go last.
 */
let admissions: Promise<unknown> = Promise.resolve()

/** Read per admission, so changing it in Settings applies to the next run. */
async function limit(): Promise<number> {
  const preferred = (await readPreferences()).maxConcurrentRuns
  return preferred > 0 ? preferred : Infinity
}

/** Resolves holding a slot. Only ever one of these is in flight. */
async function admit(): Promise<void> {
  const max = await limit()
  if (active >= max) await new Promise<void>(resolve => waiting.push(resolve))
  active++
}

export function queueDepth(): { active: number; waiting: number } {
  return { active, waiting: waiting.length }
}

/** Only for tests — a queue that outlived its process would wedge the next one. */
export function resetRunQueue(): void {
  active = 0
  waiting.length = 0
  admissions = Promise.resolve()
}

/**
 * Run `fn` once there is room, and always give the slot back.
 *
 * The release is in a `finally` rather than after the await, because a run that
 * throws still finishes — and a slot leaked on a failure is a queue that gets
 * narrower every time something goes wrong, until nothing runs at all.
 */
export async function withRunSlot<T>(fn: () => Promise<T>): Promise<T> {
  // Chained rather than raced. Nothing after this point can jump the queue,
  // because the next caller cannot even look at it until this one is in.
  const turn = admissions.then(admit)
  admissions = turn.catch(() => {})
  await turn

  try {
    return await fn()
  } finally {
    active--
    // Wake exactly one. Waking all of them would let everything through at
    // once, which is the thing this exists to prevent.
    waiting.shift()?.()
  }
}
