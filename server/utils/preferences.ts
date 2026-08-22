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

/**
 * Where a notification is posted from.
 *
 * `browser` is the page asking your browser for permission and posting the
 * banner itself. Clicking it returns to the tab you already had, on the
 * session it is about — which the desktop banner never reliably managed,
 * because it belongs to a half-second applet whose only way back here is
 * shelling out to `open` and hoping.
 *
 * `system` is that applet: it arrives with the browser shut, and pays for it
 * with a click that lands wherever the machine decides.
 *
 * `both` is for anyone who would rather have two banners than miss one.
 */
export type NotificationChannel = 'browser' | 'system' | 'both'

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['browser', 'system', 'both']

export interface NotificationPreferences {
  /** Master switch. Off means nothing is ever sent, whatever else is set. */
  enabled: boolean
  /** Something is blocked and cannot continue without you. */
  needsYou: boolean
  /** A run ended badly. */
  failed: boolean
  /** A run finished and there is something to read. */
  finished: boolean
  /** Which of the two ways of reaching you is used. */
  channel: NotificationChannel
}

/** A stored or hand-edited value, made safe to switch on. */
export function sanitiseChannel(value: unknown): NotificationChannel {
  return NOTIFICATION_CHANNELS.includes(value as NotificationChannel)
    ? value as NotificationChannel
    : DEFAULT_NOTIFICATION_CHANNEL
}

/**
 * The browser, because a notification you cannot act on is half a
 * notification. Anyone who leaves the browser shut and wants the desktop
 * banner back has one control in Settings that says so.
 */
export const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannel = 'browser'

/**
 * The command a pull request's quick action runs, keyed by what the row offers.
 *
 * These mirror `WorkIntent` in `reviews.ts` — the four states a pull request row
 * has a button for. An empty string means "use the built-in prompt", which is
 * what every action did before this existed and what most people want: the
 * built-in prompts are careful, and the most important line in all of them is
 * that nothing is posted to GitHub.
 *
 * A non-empty value replaces that prompt with whatever you type. It is sent as
 * the session's opening turn exactly as written, which is what makes a slash
 * command work: `/hd:review {url}` reaches the agent as a slash command it
 * resolves from your own settings, so you can point a quick action at your own
 * command or agent. `{url}`, `{number}`, `{title}`, `{branch}` and `{base}` are
 * filled in from the pull request; a template with no placeholder has the URL
 * appended, so `/hd:review` on its own still arrives knowing which one.
 */
export interface PullActionCommands {
  /** Somebody else's, asked of you. */
  review: string
  /** Yours, with a reviewer waiting. */
  address: string
  /** Yours, with CI red. */
  fix: string
  /** Yours, conflicting with its base. */
  update: string
}

export type PullActionIntent = keyof PullActionCommands

/** The keys, in the order the settings page draws them. */
export const PULL_ACTION_INTENTS: PullActionIntent[] = ['review', 'address', 'fix', 'update']

/**
 * How hard a run thinks before it acts — the SDK's `effort`, which is the same
 * dial the CLI turns for a session you typed into.
 *
 * It was never set, and a default nobody has checked is not a default anyone
 * chose: the same review command produced thirty-seven blocks of reasoning in
 * a terminal and none at all here, on the same repository, the same minute.
 * That is the entire difference between a review that finds the hole in a lint
 * rule and one that lists three cosmetic nits.
 *
 * Ordered weakest to hardest, which is the order the settings page draws them.
 */
export type RunEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const RUN_EFFORTS: RunEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * The SDK's own documented default, said out loud rather than left off.
 *
 * Not a change of behaviour so much as a refusal to keep depending on one: the
 * levels above this are not available on every model, and the SDK silently
 * downgrades what a model cannot do, so asking for more than a model has costs
 * nothing but is never quietly ignored either.
 */
export const DEFAULT_EFFORT: RunEffort = 'high'

/** A stored or hand-edited value, made safe to hand to the SDK. */
export function sanitiseEffort(value: unknown): RunEffort {
  return RUN_EFFORTS.includes(value as RunEffort) ? value as RunEffort : DEFAULT_EFFORT
}

/**
 * The label that puts an issue on the Land page.
 *
 * `studio`, because that is the word an `issue_labelled` ritual is most likely
 * already watching for — the two features are the same convention seen from
 * either end, and picking a second word would mean labelling everything twice.
 */
export const DEFAULT_ISSUE_LABEL = 'studio'

/**
 * A stored or hand-edited label, made safe to hand to `gh issue list --label`.
 *
 * Trimmed, and capped at GitHub's own limit. Empty is meaningful and kept: it
 * means "do not ask about a label at all", so the band is your assigned issues
 * and nothing else. That is why this cannot fall back to the default the way
 * `sanitiseEffort` does — an empty string is a choice, not an absence.
 */
export function sanitiseIssueLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 50) : DEFAULT_ISSUE_LABEL
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
  /**
   * How many turns a single run may take before the SDK stops it.
   *
   * A turn is one exchange with a tool in it, so a long piece of work spends
   * them quickly — the ceiling exists to stop a loop running all night, not to
   * describe how much work is reasonable. 0 means the built-in default.
   *
   * Was only reachable from the Agent Studio panel, which meant sessions,
   * rituals and workflows — everything anyone actually runs — were fixed at 40
   * with no way to say otherwise.
   */
  maxTurns: number
  /**
   * How many unattended runs may go at once — rituals, self-repair, workflow
   * steps. A turn you typed is never queued. 0 means no limit.
   *
   * Three by default rather than unlimited, which is what it was: ten rituals
   * due at the same minute started ten agents on a machine nobody was watching.
   */
  maxConcurrentRuns: number
  /**
   * Hold unattended work back when Claude says you are near your rate limit.
   *
   * The other limits here are denominated in dollars, which is the right unit
   * for somebody paying per token and the wrong one for everybody on Pro or
   * Max — they are never billed for a run, and what actually stops them is the
   * subscription's own limit. This is that limit, expressed in the only signal
   * that is always present.
   *
   * Off by default, like the spending caps and for the same reason: a limit
   * nobody chose is a limit that stops their work at the worst possible moment.
   */
  pauseOnQuotaWarning: boolean
  /**
   * What each pull request quick action runs. Empty strings throughout means
   * every action uses its built-in prompt, which is the default and was the
   * only behaviour before this setting existed.
   */
  pullActions: PullActionCommands
  /**
   * How hard every run thinks, unless it was asked for something else.
   *
   * One setting for the machine rather than one per session, for the same
   * reason `maxTurns` is: sessions, rituals and workflows all pass nothing, so
   * a knob that only the Studio panel could reach would be a knob nobody
   * actually running work ever turned.
   */
  effort: RunEffort
  /**
   * Which label puts an issue on Land, on top of the ones assigned to you.
   *
   * Empty means no label is asked about, leaving the band to your assigned
   * issues alone.
   */
  issueLabel: string
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
    channel: DEFAULT_NOTIFICATION_CHANNEL,
  },
  summariseSessions: true,
  dailyCapUsd: 0,
  runCapUsd: 0,
  repairAttempts: 0,
  maxTurns: 0,
  maxConcurrentRuns: 3,
  pauseOnQuotaWarning: false,
  pullActions: { review: '', address: '', fix: '', update: '' },
  effort: DEFAULT_EFFORT,
  issueLabel: DEFAULT_ISSUE_LABEL,
}

/**
 * A stored pull-action map, made safe to use: every key present, every value a
 * trimmed string. A hand-edited file with a missing key or a number where a
 * command should be must not reach the code that builds a turn from it.
 */
export function sanitisePullActions(value: unknown): PullActionCommands {
  const source = (value ?? {}) as Record<string, unknown>
  const clean = {} as PullActionCommands
  for (const key of PULL_ACTION_INTENTS) {
    const raw = source[key]
    clean[key] = typeof raw === 'string' ? raw.trim() : ''
  }
  return clean
}

/** A limit is a positive number of dollars or it is not a limit. */
export function positiveOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Nobody's runaway loop is worth more than this, whatever the file says. */
export const MAX_REPAIR_ATTEMPTS = 10

/** The SDK's own ceiling. Asking for more is asking for something it won't do. */
export const MAX_TURNS_CEILING = 200

/** 0 is "use the built-in default", which is what an unset preference means. */
export function clampTurns(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), MAX_TURNS_CEILING)
}

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
      // Last, so a hand-edited file naming a channel that does not exist gets
      // the default rather than a value `send` will not recognise.
      channel: sanitiseChannel(parsed?.preferences?.notifications?.channel),
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
    // Same clamp the request path uses, so a hand-edited file cannot ask for
    // a thousand turns any more than the settings page can.
    maxTurns: clampTurns(parsed?.preferences?.maxTurns),
    // Absent means the default, not unlimited — a file written before this
    // existed says nothing about it.
    maxConcurrentRuns: parsed?.preferences?.maxConcurrentRuns ?? DEFAULT_PREFERENCES.maxConcurrentRuns,
    // Absent means off — a file written before this existed never chose it.
    pauseOnQuotaWarning: parsed?.preferences?.pauseOnQuotaWarning === true,
    // Filled key by key, so a file written before this existed reads as "every
    // action uses its built-in prompt" rather than as undefined.
    pullActions: sanitisePullActions(parsed?.preferences?.pullActions),
    // Absent means the default, which is also what an unrecognised level means
    // — a typo here must not hand the SDK a value it will reject.
    effort: sanitiseEffort(parsed?.preferences?.effort),
    // Absent means the default. Present and empty means somebody turned the
    // label half of the issue band off, which is why `??` rather than `||`.
    issueLabel: sanitiseIssueLabel(parsed?.preferences?.issueLabel ?? DEFAULT_ISSUE_LABEL),
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
    maxTurns?: number
    maxConcurrentRuns?: number
    pauseOnQuotaWarning?: boolean
    pullActions?: Partial<PullActionCommands>
    effort?: RunEffort
    issueLabel?: string
  },
): Promise<Preferences> {
  const {
    summariseSessions, dailyCapUsd, runCapUsd, repairAttempts, maxTurns, maxConcurrentRuns,
    pauseOnQuotaWarning, pullActions, effort, issueLabel,
    ...notifications
  } = patch

  return preferencesStore.update((current) => {
    const next: Preferences = {
      notifications: { ...current.notifications, ...notifications },
      summariseSessions: summariseSessions ?? current.summariseSessions,
      dailyCapUsd: dailyCapUsd === undefined ? current.dailyCapUsd : positiveOrZero(dailyCapUsd),
      runCapUsd: runCapUsd === undefined ? current.runCapUsd : positiveOrZero(runCapUsd),
      repairAttempts: repairAttempts === undefined ? current.repairAttempts : clampAttempts(repairAttempts),
      maxTurns: maxTurns === undefined ? current.maxTurns : clampTurns(maxTurns),
      maxConcurrentRuns: maxConcurrentRuns === undefined
        ? current.maxConcurrentRuns
        : Math.max(0, Math.min(Math.floor(maxConcurrentRuns), 20)),
      pauseOnQuotaWarning: pauseOnQuotaWarning === undefined
        ? current.pauseOnQuotaWarning
        : pauseOnQuotaWarning === true,
      // Merged over what is stored, so saving one action does not blank the
      // other three — the settings page sends only the field that changed.
      pullActions: pullActions === undefined
        ? current.pullActions
        : sanitisePullActions({ ...current.pullActions, ...pullActions }),
      effort: effort === undefined ? current.effort : sanitiseEffort(effort),
      issueLabel: issueLabel === undefined ? current.issueLabel : sanitiseIssueLabel(issueLabel),
    }
    Object.assign(current, next)
    return next
  })
}
