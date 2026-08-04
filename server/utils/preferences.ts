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

export async function savePreferences(patch: Partial<NotificationPreferences>): Promise<Preferences> {
  return preferencesStore.update((current) => {
    const next: Preferences = {
      notifications: { ...current.notifications, ...patch },
    }
    Object.assign(current, next)
    return next
  })
}
