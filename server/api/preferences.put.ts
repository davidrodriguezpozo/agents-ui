import { EDITOR_CHOICES, type EditorChoice } from '../utils/editors'
import { asProviderId, type ProviderId } from '../utils/providers'
import type { NotionIntakeConfig } from '../utils/notionIntake'
import {
  savePreferences,
  sanitisePullActions,
  NOTIFICATION_CHANNELS,
  RUN_EFFORTS,
  type NotificationChannel,
  type NotificationPreferences,
  type PullActionCommands,
  type RunEffort,
} from '../utils/preferences'

/**
 * The switches, listed rather than derived from the interface: `channel` is a
 * key of it too and is not a boolean, so a loop over every key would be a loop
 * that assigns `true` to it.
 */
const KEYS = ['enabled', 'needsYou', 'failed', 'finished'] as const

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    notifications?: Partial<NotificationPreferences>
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    pauseOnQuotaWarning?: boolean
    quotaFallbackProvider?: string | null
    dailyCapUsd?: number
    runCapUsd?: number
    pullActions?: Partial<PullActionCommands>
    openStartedSessions?: boolean
    effort?: RunEffort
    issueLabel?: string
    notionIntake?: Partial<NotionIntakeConfig>
    issueWriteback?: boolean
    editor?: EditorChoice
  }>(event)

  // Only the switches, and only as booleans — nothing else belongs in here.
  const patch: Partial<NotificationPreferences> & {
    summariseSessions?: boolean
    repairAttempts?: number
    maxTurns?: number
    maxConcurrentRuns?: number
    pauseOnQuotaWarning?: boolean
    quotaFallbackProvider?: ProviderId | null
    dailyCapUsd?: number
    runCapUsd?: number
    pullActions?: Partial<PullActionCommands>
    openStartedSessions?: boolean
    effort?: RunEffort
    issueLabel?: string
    notionIntake?: Partial<NotionIntakeConfig>
    issueWriteback?: boolean
    editor?: EditorChoice
  } = {}
  for (const key of KEYS) {
    const value = body?.notifications?.[key]
    if (typeof value === 'boolean') patch[key] = value
  }

  // Only a channel that exists. Anything else is left alone rather than stored
  // and then quietly ignored by every notification after it.
  const channel = body?.notifications?.channel
  if (NOTIFICATION_CHANNELS.includes(channel as NotificationChannel)) patch.channel = channel

  if (typeof body?.summariseSessions === 'boolean') {
    patch.summariseSessions = body.summariseSessions
  }

  if (typeof body?.pauseOnQuotaWarning === 'boolean') {
    patch.pauseOnQuotaWarning = body.pauseOnQuotaWarning
  }

  /*
   * Null clears it, and so does a name this build does not know — cleared
   * rather than ignored, because ignoring it would leave the previous agent in
   * place under a page that has just said it saved. A fallback that is
   * configured, looks configured and turns out at 03:00 to be nothing at all is
   * the failure this whole field exists to avoid.
   */
  if (body?.quotaFallbackProvider !== undefined) {
    patch.quotaFallbackProvider = body.quotaFallbackProvider === null
      ? null
      : asProviderId(body.quotaFallbackProvider) ?? null
  }

  // A boolean or nothing, like the switches above: a truthy string arriving
  // from a hand-rolled request must not be able to turn navigation back on.
  if (typeof body?.openStartedSessions === 'boolean') {
    patch.openStartedSessions = body.openStartedSessions
  }

  // 0 is meaningful — it is how a limit is turned off — so these are only
  // ignored when absent, not when falsy.
  if (typeof body?.dailyCapUsd === 'number') patch.dailyCapUsd = body.dailyCapUsd
  if (typeof body?.runCapUsd === 'number') patch.runCapUsd = body.runCapUsd
  // Same reasoning: 0 is how this is turned off, so absent is the only skip.
  if (typeof body?.repairAttempts === 'number') patch.repairAttempts = body.repairAttempts
  // 0 is how this returns to the built-in default, so absent is the only skip.
  if (typeof body?.maxTurns === 'number') patch.maxTurns = body.maxTurns
  if (typeof body?.maxConcurrentRuns === 'number') patch.maxConcurrentRuns = body.maxConcurrentRuns

  // Only a level the SDK actually has. Anything else is left alone rather than
  // saved and silently rejected on the next run.
  if (RUN_EFFORTS.includes(body?.effort as RunEffort)) patch.effort = body.effort

  // An empty string is how the label half of the issue band is turned off, so
  // absent is the only skip — a falsy check here would make it unturnoffable.
  if (typeof body?.issueLabel === 'string') patch.issueLabel = body.issueLabel

  // A boolean or nothing. This is the switch on the one write other people can
  // see, and a truthy string arriving from a hand-rolled request must not be
  // able to turn it on.
  if (typeof body?.issueWriteback === 'boolean') patch.issueWriteback = body.issueWriteback

  // Only one of the four this app knows a URL scheme for. Anything else is left
  // alone rather than stored and then found to open nothing.
  if (EDITOR_CHOICES.includes(body?.editor as EditorChoice)) patch.editor = body.editor

  // A partial, like `pullActions`, and for the same reason: the settings page
  // saves one field on blur. Only the keys actually sent are forwarded, each as a
  // string, so a number in `statusValue` cannot reach the prompt a run is asked.
  // Empty strings pass through — that is how a half of this is turned off.
  if (body?.notionIntake && typeof body.notionIntake === 'object') {
    const sent = body.notionIntake as Record<string, unknown>
    const only: Partial<NotionIntakeConfig> = {}
    for (const key of ['dataSource', 'statusProperty', 'statusValue'] as const) {
      if (typeof sent[key] === 'string') only[key] = sent[key] as string
    }
    if (Object.keys(only).length) patch.notionIntake = only
  }

  // A partial is expected — the settings page sends only the action it changed,
  // and `savePreferences` merges it over the three it did not. Sanitised here so
  // only the keys the client actually sent are forwarded, each a trimmed string.
  if (body?.pullActions && typeof body.pullActions === 'object') {
    const sent = body.pullActions as Record<string, unknown>
    const full = sanitisePullActions(sent)
    const only: Partial<PullActionCommands> = {}
    for (const key of Object.keys(full) as (keyof PullActionCommands)[]) {
      if (key in sent) only[key] = full[key]
    }
    if (Object.keys(only).length) patch.pullActions = only
  }

  return savePreferences(patch)
})
