import type { WallSnapshot, WallTile } from '~/utils/wall'

/**
 * What the fleet sounds like.
 *
 * The wall answers "is anything wrong" to somebody who looks at it. Sound answers
 * it to somebody who does not — which is most of the day, and the whole premise of
 * a product about work that carries on while you are elsewhere. The useful thing
 * is not any individual noise: it is that a normal afternoon has a *texture*, and
 * you notice the morning it changes without having decided to check.
 *
 * Three rules make it information rather than a novelty:
 *
 * **Silence is the resting state.** Nothing plays on a poll where nothing
 * happened, and nothing plays for a state that merely persists. A screen that
 * chirps every two and a half seconds to say the machine is still on teaches a
 * room to stop hearing it, which costs the one sound that mattered.
 *
 * **Opening the wall is not news.** The first snapshot produces nothing at all,
 * however much is in it. Otherwise arriving at a display would replay the whole
 * morning as a burst of noise — every one of those events is real, and none of
 * them is happening.
 *
 * **A repository has a pitch.** Derived from its name, so it is the same pitch
 * tomorrow and on somebody else's machine. This is what turns a stream of ticks
 * into something you can read: after a day you know which repo is working without
 * looking up, in the way you know which stair creaks.
 *
 * What plays is decided here, from the same snapshots the screen draws, so the
 * sound and the picture can never disagree. How it is made — oscillators,
 * envelopes, the actual noise — is `useSound`, and nothing in this file knows
 * about it.
 */

export type SoundKind =
  /** A tool call. The heartbeat, and by far the most common. */
  | 'tick'
  /** A turn started working. */
  | 'start'
  /** The project's own checks came good. */
  | 'pass'
  /** A turn failed, or its checks did. */
  | 'fail'
  /** Work landed in the base branch. The best news this app has. */
  | 'land'
  /** Something stopped and is waiting for a person. */
  | 'attention'

export interface SoundEvent {
  kind: SoundKind
  /** Which repository it came from, which is what decides the pitch. */
  repo?: string
}

/**
 * Ticks are capped per poll.
 *
 * Six sessions each making eight tool calls between polls is forty-eight sounds
 * in two and a half seconds, which is not a heartbeat, it is static. Three is
 * enough to convey "busy" — the tiles carry the actual count, and a wall that
 * lies about *how* busy in the direction of calm is the right way round.
 */
export const TICKS_PER_POLL = 3

/** Everything, in the order it should be heard when a poll brings several. */
const PRIORITY: SoundKind[] = ['land', 'attention', 'fail', 'pass', 'start', 'tick']

export interface SoundDiff {
  events: SoundEvent[]
  /** The newest tick accounted for, to be passed back on the next poll. */
  tickAt: number
}

function byId(tiles: WallTile[]): Map<string, WallTile> {
  return new Map(tiles.map(tile => [tile.sessionId, tile]))
}

/**
 * What changed between two polls, as sound.
 *
 * Everything here is a *transition* between two snapshots that both contain the
 * session. A tile seen for the first time is only ever news if it is working: a
 * session that appears already failed has usually just come back into the window
 * this wall draws, and announcing it as a failure would be an alarm about
 * something that happened on Tuesday.
 */
export function diffSounds(
  previous: WallSnapshot | null,
  next: WallSnapshot,
  seenTickAt = 0,
): SoundDiff {
  const newest = next.ticker.reduce((max, tick) => Math.max(max, tick.at), seenTickAt)

  // The first snapshot is the state of the world, not a set of things that just
  // happened. Nothing plays, and every tick in it counts as already heard.
  if (!previous) return { events: [], tickAt: newest }

  const before = byId(previous.tiles)
  const events: SoundEvent[] = []

  for (const tile of next.tiles) {
    const was = before.get(tile.sessionId)

    if (!was) {
      if (tile.activity === 'working') events.push({ kind: 'start', repo: tile.repo })
      continue
    }

    if (tile.landedAt && !was.landedAt) {
      // The end of the story outranks everything else this session might also
      // have done in the same poll, so nothing else is reported for it.
      events.push({ kind: 'land', repo: tile.repo })
      continue
    }

    if (tile.pending > 0 && was.pending === 0) {
      events.push({ kind: 'attention', repo: tile.repo })
      continue
    }

    if (tile.activity === 'failed' && was.activity !== 'failed') {
      events.push({ kind: 'fail', repo: tile.repo })
      continue
    }

    const status = tile.check?.status
    const had = was.check?.status
    if (status !== had) {
      if (status === 'failing') events.push({ kind: 'fail', repo: tile.repo })
      else if (status === 'passing') events.push({ kind: 'pass', repo: tile.repo })
      continue
    }

    if (tile.activity === 'working' && was.activity !== 'working') {
      events.push({ kind: 'start', repo: tile.repo })
    }
  }

  // Ticks are what is left: the ordinary noise of work happening, newest first
  // so that capping keeps the most recent rather than the oldest.
  const fresh = next.ticker
    .filter(tick => tick.at > seenTickAt)
    .sort((a, b) => b.at - a.at)
    .slice(0, TICKS_PER_POLL)

  for (const tick of fresh) events.push({ kind: 'tick', repo: tick.repo })

  return { events: order(events), tickAt: newest }
}

/**
 * Good news first, ticks last.
 *
 * A poll can bring a merge and eleven tool calls, and the merge is the one worth
 * hearing clearly — so it is played before the noise rather than buried a fifth
 * of a second inside it.
 */
export function order(events: SoundEvent[]): SoundEvent[] {
  return [...events].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
}

/**
 * A pentatonic scale, in semitones from the root.
 *
 * Pentatonic because every combination of its notes is consonant: two
 * repositories working at once will sound like music rather than like a mistake,
 * and no pair of pitches can produce the semitone clash that reads as an alarm.
 */
export const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]

/**
 * Which note a repository gets — stable, from its name.
 *
 * A hash rather than an allocation order, so the pitch survives a restart, is the
 * same on two machines, and does not change when a project is added to the list
 * above it. Learning that `billing` is the low one is only worth anything if it
 * stays the low one.
 */
export function pitchIndexFor(repo: string | undefined): number {
  if (!repo) return 0

  let hash = 0
  for (let i = 0; i < repo.length; i++) hash = (hash * 31 + repo.charCodeAt(i)) | 0

  return Math.abs(hash) % SCALE.length
}

/** Hertz for a repository, from a root note. Equal temperament, twelfth root. */
export function frequencyFor(repo: string | undefined, rootHz = 220): number {
  return rootHz * 2 ** (SCALE[pitchIndexFor(repo)]! / 12)
}

/**
 * A note, described rather than played.
 *
 * The six sounds live here, as data, for the same reason the wall's ordering
 * rules do: they are decisions, and a decision inside a `switch` in a composable
 * that needs a browser, a speaker and a gesture to reach is a decision nobody can
 * check. As a list of notes they can be asserted — that a failure falls and a pass
 * rises, that only landing is allowed to ring for a second — and `useSound` is
 * left as the renderer, which is the part that genuinely needs the browser.
 */
export type WaveShape = 'sine' | 'triangle' | 'square' | 'sawtooth'

export interface Note {
  /** Seconds after the sound begins. */
  delay: number
  hz: number
  /** Seconds. */
  length: number
  type: WaveShape
  /** Peak of the envelope, 0–1, before the master gain. */
  gain: number
  /** Slides to this frequency across the note, for a falling tone. */
  to?: number
}

/**
 * Each sound has a shape somebody can learn without being told: work rises,
 * failure falls, landing rings, and the one that wants a person is the only one
 * that repeats itself. Deliberately not six variations of one beep.
 */
export function notesFor(kind: SoundKind, hz: number): Note[] {
  switch (kind) {
    case 'tick':
      // An octave up and very short — the sound of something small happening.
      return [{ delay: 0, hz: hz * 2, length: 0.055, gain: 0.18, type: 'triangle' }]

    case 'start':
      // A rising fifth: the shape of setting off.
      return [
        { delay: 0, hz, length: 0.09, gain: 0.3, type: 'triangle' },
        { delay: 0.075, hz: hz * 1.5, length: 0.12, gain: 0.3, type: 'triangle' },
      ]

    case 'pass':
      // A major arpeggio, which is the least ambiguous "good" in music.
      return [
        { delay: 0, hz, length: 0.1, gain: 0.32, type: 'triangle' },
        { delay: 0.08, hz: hz * 1.26, length: 0.1, gain: 0.32, type: 'triangle' },
        { delay: 0.16, hz: hz * 1.5, length: 0.22, gain: 0.32, type: 'triangle' },
      ]

    case 'fail':
      // Falling, muted and low. Not a klaxon: a wall that alarms is a wall
      // somebody turns off, and then the next failure is silent too.
      return [{ delay: 0, hz: hz * 0.5, length: 0.34, gain: 0.34, type: 'sine', to: hz * 0.34 }]

    case 'land':
      // A bell — a fundamental with an inharmonic partial, decaying long. The
      // only sound allowed to take a second, because it is the only one that
      // means the work is finished.
      return [
        { delay: 0, hz: hz * 2, length: 1.1, gain: 0.3, type: 'sine' },
        { delay: 0.005, hz: hz * 2 * 2.76, length: 0.7, gain: 0.1, type: 'sine' },
        { delay: 0.01, hz: hz * 3, length: 0.5, gain: 0.08, type: 'sine' },
      ]

    case 'attention':
      // Two notes, down then up, twice — the pattern of being asked a question.
      // The repetition is what distinguishes it from everything else here.
      return [
        { delay: 0, hz: hz * 1.5, length: 0.11, gain: 0.34, type: 'triangle' },
        { delay: 0.13, hz, length: 0.11, gain: 0.34, type: 'triangle' },
        { delay: 0.34, hz: hz * 1.5, length: 0.11, gain: 0.3, type: 'triangle' },
        { delay: 0.47, hz, length: 0.16, gain: 0.3, type: 'triangle' },
      ]
  }
}

/** How long a sound lasts, including everything scheduled after its first note. */
export function lengthOf(kind: SoundKind, hz = 220): number {
  return notesFor(kind, hz).reduce((longest, note) => Math.max(longest, note.delay + note.length), 0)
}

/**
 * The vocabulary, in words, most important first.
 *
 * A wall in a shared room makes noises that other people hear, and the first
 * question is always "what was that?". Each entry says what the sound *is* as well
 * as what it means, so the legend answers that without a demonstration.
 */
export const SOUND_LABELS: Record<SoundKind, string> = {
  land: 'a bell — work landed',
  attention: 'two notes twice — something waits for you',
  fail: 'a falling note — a failure',
  pass: 'three rising notes — checks passed',
  start: 'a rising pair — a turn started',
  tick: 'short ticks — tool calls',
}
