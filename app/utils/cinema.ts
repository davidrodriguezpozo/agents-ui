/**
 * Cinema mode: the wall, rotating, for a screen with an audience.
 *
 * The wall answers three questions at a glance, which works because somebody is
 * glancing. A screen at the end of a room for an hour is a different problem:
 * one still image stops being looked at within a minute, and everything the
 * machine knows that is *not* on that image is invisible for the whole hour.
 *
 * So it rotates. An airport board rather than a dashboard — one idea at a time,
 * large enough to read from the back, on a clock.
 *
 * Two rules keep it from becoming a screensaver:
 *
 * **An act with nothing to say is not shown.** Twenty seconds of "nothing has
 * landed today" is how a display teaches a room to ignore it. Nothing landed
 * means no landing act, and the rotation is shorter that day. This is the same
 * reasoning the Slack digest already applies to a quiet morning.
 *
 * **Urgency outranks the show.** While something is waiting on a person, the
 * rotation narrows to the two acts they can act on and drops the retrospective
 * ones — because a wall that cycles through last night's costs while a session
 * sits blocked is entertaining somebody instead of telling them.
 */

export type ActId = 'needs-you' | 'fleet' | 'night' | 'landed'

export interface Act {
  id: ActId
  /** Named on screen, so nobody has to work out what they are looking at. */
  label: string
  /**
   * How long it holds.
   *
   * Longer for the acts that are a *list* somebody reads, shorter for the ones
   * that are one number. The fleet gets the most because it is the only act
   * whose content changes while it is on screen.
   */
  dwellMs: number
}

/** Canonical order. The rotation is always a subset of this, in this sequence. */
export const ACTS: Act[] = [
  { id: 'needs-you', label: 'Needs you', dwellMs: 18_000 },
  { id: 'fleet', label: 'The fleet', dwellMs: 26_000 },
  { id: 'night', label: 'The night', dwellMs: 20_000 },
  { id: 'landed', label: 'Landed today', dwellMs: 18_000 },
]

/*
 * There is deliberately no money act.
 *
 * Almost everybody running this is on a subscription and is never billed for a
 * run at all, so a screen-sized dollar figure would be a notional number given
 * the largest type on the wall. What can actually stop their work at 09:00 is the
 * rate limit, and that has a permanent meter in the header — visible during every
 * act, which is better than being true for fourteen seconds in five.
 */

export function actById(id: ActId): Act {
  return ACTS.find(act => act.id === id) ?? ACTS[1]!
}

export interface CinemaInput {
  /** Things that will not move until a person does something. */
  needsYou: number
  /** Sessions the wall is currently drawing. */
  tiles: number
  landedToday: number
  /** Runs inside the night-shift window — whether that chart has anything in it. */
  runsInWindow: number
}

/**
 * Which acts have something to say, in order.
 *
 * The fleet is always in, even with no sessions: its empty state is a real
 * statement — nothing is running, here is what is due next — and a rotation of
 * length zero has nothing to fall back on.
 */
export function actsFor(input: CinemaInput): Act[] {
  if (input.needsYou > 0) {
    // Narrowed on purpose. See the note at the top of this file.
    return [actById('needs-you'), actById('fleet')]
  }

  return ACTS.filter((act) => {
    switch (act.id) {
      case 'needs-you': return false
      case 'fleet': return true
      case 'night': return input.runsInWindow > 0
      case 'landed': return input.landedToday > 0
    }
  })
}

/**
 * The next act round the loop.
 *
 * An act that has left the rotation while it was on screen — the last thing
 * waiting on you was answered, so `needs-you` is gone — resolves to the first
 * available one rather than to nothing. That is the common case at the moment a
 * wall becomes good news, so it must not be the case that breaks it.
 */
export function nextAct(currentId: ActId, acts: Act[]): Act {
  const fallback = acts[0] ?? actById('fleet')
  const index = acts.findIndex(act => act.id === currentId)
  if (index < 0) return fallback

  return acts[(index + 1) % acts.length] ?? fallback
}

export function prevAct(currentId: ActId, acts: Act[]): Act {
  const fallback = acts[0] ?? actById('fleet')
  const index = acts.findIndex(act => act.id === currentId)
  if (index < 0) return fallback

  return acts[(index - 1 + acts.length) % acts.length] ?? fallback
}

/** How far through the current act we are, 0–1, for the hairline at the top. */
export function progressOf(startedAt: number, now: number, dwellMs: number): number {
  if (!dwellMs || now <= startedAt) return 0
  return Math.max(0, Math.min(1, (now - startedAt) / dwellMs))
}

/** Whether the act has had its time. Paused rotations never have. */
export function isDue(startedAt: number, now: number, dwellMs: number): boolean {
  return now - startedAt >= dwellMs
}
