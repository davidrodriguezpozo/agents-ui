import { EventEmitter } from 'node:events'
import type { NotifyKind } from './notify'

/**
 * The other end of a notification: the browser that is already open.
 *
 * A desktop banner arrives wherever you are, which is its whole advantage, and
 * pays for it by having nowhere to send you — it belongs to an application,
 * and on macOS ours is a half-second AppleScript applet whose only trick is
 * shelling out to `open`. That works, mostly, and "mostly" is the problem: a
 * click can land in the wrong browser, on a second copy of a page you already
 * had, or nowhere at all if the applet was replaced between the banner and the
 * click.
 *
 * A notification the browser itself posted has none of that trouble. The page
 * that asked for permission is the page the click returns to — same tab, same
 * scroll position, one navigation, no new window. The cost is honest and
 * stated in Settings: a browser that is shut posts nothing.
 *
 * This is the pipe between the two halves. `notify` publishes here, every
 * connected tab is listening on `/api/notifications/stream`, and the recent
 * few are kept so that a tab which drops its connection for thirty seconds
 * does not lose whatever happened during them.
 */

export interface BrowserNotification {
  /** Unique for the life of the process, and the client's replay cursor. */
  id: string
  kind: NotifyKind
  title: string
  body: string
  /** A path within this app, resolved against the tab's own origin. */
  link: string
  at: number
  /**
   * A test asked for from Settings, and the one notification a tab shows
   * unconditionally — see `shouldNotify`. Without it the proof is eaten by the
   * rule it exists to prove: the button is on `/settings`, the banner points at
   * `/settings`, so the tab that asked for it decides you can already see it.
   */
  test?: true
}

/**
 * Which process a cursor came from.
 *
 * Ids have to be comparable across a reconnect, and a counter that starts at
 * zero again after a restart is not: a tab holding `42` would silently drop
 * the next forty-two notifications as things it had already seen. Stamping the
 * boot into the id makes a stale cursor obviously stale rather than quietly
 * wrong — see `replayableNotifications`, which throws such a cursor away.
 */
const BOOT = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let sequence = 0

const emitter = new EventEmitter()
// One `notify` can be read by a dozen tabs, and Node warns at eleven listeners
// on the assumption that a leak is likelier than a crowd. Here it is a crowd.
emitter.setMaxListeners(0)

/**
 * How much history a reconnecting tab is allowed to catch up on.
 *
 * Small on purpose. This exists for a dropped connection and a laptop lid, not
 * for a browser opened the next morning — nobody wants last night's four
 * banners arriving at once, all of them about work that has since finished.
 */
export const REPLAY_MS = 2 * 60_000

/** Enough for a burst of parallel runs finishing together, and no more. */
const KEEP = 50

const recent: BrowserNotification[] = []

/** Everything still held, oldest first. Exported for the stream and its tests. */
export function recentBrowserNotifications(): BrowserNotification[] {
  return [...recent]
}

/**
 * What a tab that says it last saw `cursor` still needs.
 *
 * Three things are refused: a cursor from a previous boot (its numbers mean
 * nothing here), no cursor at all (a tab opening fresh is not owed a backlog),
 * and anything older than the replay window.
 */
export function replayableNotifications(
  entries: BrowserNotification[],
  cursor: string | undefined,
  now: number,
  windowMs = REPLAY_MS,
): BrowserNotification[] {
  if (!cursor || !cursor.startsWith(`${BOOT}-`)) return []

  const after = Number(cursor.slice(BOOT.length + 1))
  if (!Number.isFinite(after)) return []

  return entries.filter(entry => Number(entry.id.slice(BOOT.length + 1)) > after && now - entry.at <= windowMs)
}

/**
 * Post one notification to every open tab.
 *
 * Nothing here is allowed to care whether anybody is listening: work that runs
 * unattended is the normal case, and a run must not behave differently because
 * a browser happened to be shut.
 */
export function publishBrowserNotification(
  input: Omit<BrowserNotification, 'id' | 'at'>,
): BrowserNotification {
  const entry: BrowserNotification = { ...input, id: `${BOOT}-${sequence++}`, at: Date.now() }

  recent.push(entry)
  if (recent.length > KEEP) recent.splice(0, recent.length - KEEP)

  emitter.emit('notification', entry)
  return entry
}

/** Follow live. Returns the unsubscribe, which the stream calls on close. */
export function subscribeBrowserNotifications(
  listener: (entry: BrowserNotification) => void,
): () => void {
  emitter.on('notification', listener)
  return () => emitter.off('notification', listener)
}

/** Tests only: a fresh process is the only other way to empty this. */
export function resetBrowserNotifications(): void {
  recent.length = 0
}
