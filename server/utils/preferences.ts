import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'

/**
 * How this machine wants to be interrupted.
 *
 * Kept apart from Claude's own settings.json: that file belongs to Claude Code
 * and is shared with everything else that reads it. These are preferences for
 * this app, and losing them costs nothing but a re-tick.
 */

export interface NotificationPreferences {
  /** Master switch. Off means nothing is ever sent, whatever else is set. */
  enabled: boolean
  /** Something is blocked and cannot continue without you. */
  needsYou: boolean
  /** A run ended badly. */
  failed: boolean
  /** A run finished and there is something to read. */
  finished: boolean
}

export interface Preferences {
  notifications: NotificationPreferences
  /**
   * Have a small model say what each session did, in a sentence.
   *
   * On by default because the list is otherwise mute about the thing you most
   * want to know, and off is a real choice: it spends a fraction of a cent on
   * every turn that changes files, which is money wasted on anyone who reads
   * their own diffs.
   */
  summariseSessions: boolean
  /**
   * Most this machine may spend in a day, across sessions, rituals and
   * everything else. 0 or absent means no limit.
   *
   * Off by default: a limit somebody did not choose is a limit that stops
   * their work at the worst possible moment, having never warned them.
   */
  dailyCapUsd: number
  /** Most a single run may spend before the SDK stops it. 0 means no limit. */
  runCapUsd: number
  /**
   * How many turns a session may spend fixing its own failing checks before it
   * stops and waits for you. 0 or absent means it never tries.
   *
   * Off by default, for the same reason the spending limits are the other way
   * round: this one spends money without being asked, on work nobody watched
   * being decided. Turning it on should be somebody's choice. **Fix it** on a
   * failing session works either way — pressing a button is that choice.
   */
  repairAttempts: number
}

/**
 * Defaults lean quiet-but-useful: the two that are actionable are on, and so
 * is "finished" — a session turn you are waiting on is the common case for
 * having installed this at all.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  notifications: {
    enabled: true,
    needsYou: true,
    failed: true,
    finished: true,
  },
  summariseSessions: true,
  dailyCapUsd: 0,
  runCapUsd: 0,
  repairAttempts: 0,
}

/** A limit is a positive number of dollars or it is not a limit. */
export function positiveOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Nobody's runaway loop is worth more than this, whatever the file says. */
export const MAX_REPAIR_ATTEMPTS = 10

/** Lives here rather than with the repair loop so that reading a preference
 * does not depend on the thing that consumes it. */
export function clampAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), MAX_REPAIR_ATTEMPTS)
}

export const preferencesStore = defineJsonStore<Preferences>({
  label: 'preferences',
  path: () => join(getClaudeDir(), 'agents-ui', 'preferences.json'),
  empty: () => DEFAULT_PREFERENCES,
  decode: parsed => ({
    notifications: {
      ...DEFAULT_PREFERENCES.notifications,
      ...(parsed?.preferences?.notifications ?? {}),
    },
    // A file written before this preference existed says nothing about it,
    // which is not the same as saying no.
    summariseSessions: parsed?.preferences?.summariseSessions ?? DEFAULT_PREFERENCES.summariseSessions,
    // A negative or non-numeric limit would read as "stop everything", so
    // anything that is not a usable number means no limit at all.
    dailyCapUsd: positiveOrZero(parsed?.preferences?.dailyCapUsd),
    runCapUsd: positiveOrZero(parsed?.preferences?.runCapUsd),
    // Clamped on the way in as well as the way out: a hand-edited file saying
    // 500 should not buy a session five hundred turns at its own discretion.
    repairAttempts: clampAttempts(parsed?.preferences?.repairAttempts),
  }),
  encode: preferences => ({ version: 1, preferences }),
})

export async function readPreferences(): Promise<Preferences> {
  try {
    return await preferencesStore.read()
  } catch {
    // Unreadable preferences must not stop a run from happening — unlike
    // sessions or rituals, there is nothing here worth failing over.
    return DEFAULT_PREFERENCES
  }
}

export async function savePreferences(
  patch: Partial<NotificationPreferences> & {
    summariseSessions?: boolean
    dailyCapUsd?: number
    runCapUsd?: number
    repairAttempts?: number
  },
): Promise<Preferences> {
  const { summariseSessions, dailyCapUsd, runCapUsd, repairAttempts, ...notifications } = patch

  return preferencesStore.update((current) => {
    const next: Preferences = {
      notifications: { ...current.notifications, ...notifications },
      summariseSessions: summariseSessions ?? current.summariseSessions,
      dailyCapUsd: dailyCapUsd === undefined ? current.dailyCapUsd : positiveOrZero(dailyCapUsd),
      runCapUsd: runCapUsd === undefined ? current.runCapUsd : positiveOrZero(runCapUsd),
      repairAttempts: repairAttempts === undefined ? current.repairAttempts : clampAttempts(repairAttempts),
    }
    Object.assign(current, next)
    return next
  })
}
