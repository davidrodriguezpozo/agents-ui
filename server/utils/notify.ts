import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import { readPreferences } from './preferences'

/**
 * Telling you something happened while you were not looking.
 *
 * This is the other half of running as a service. Work that proceeds without
 * you is only useful if it can reach you when it stops being able to — a
 * ritual blocked on a permission at 08:00 is worth exactly nothing if the
 * first you hear of it is at 11:00.
 *
 * The notification goes to the operating system rather than the browser on
 * purpose: the browser is usually shut, which is the case this exists for.
 */

export type NotifyKind = 'needsYou' | 'failed' | 'finished'

/**
 * AppleScript has no parameter binding — the text is part of the program. A
 * title containing a quote would end the string and the rest would be run as
 * code, so both escapable characters are escaped and newlines are flattened.
 * (`execFile` keeps a shell out of it; this covers the layer below that.)
 */
export function appleScriptString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
}

/** Long output makes an unreadable banner, so say the first useful thing. */
export function summarize(text: string, limit = 120): string {
  const flat = text.replace(/[\s#*`>_-]+/g, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit - 1).trimEnd()}…`
}

function send(title: string, body: string): void {
  const os = platform()

  if (os === 'darwin') {
    const script = `display notification "${appleScriptString(body)}" with title "${appleScriptString(title)}"`
    execFile('osascript', ['-e', script], () => {})
    return
  }

  if (os === 'linux') {
    execFile('notify-send', ['--app-name=Agent Manager', title, body], () => {})
  }

  // Anywhere else, staying silent is the whole behaviour.
}

/**
 * Best-effort by design: a run must never fail, stall or log noise because the
 * desktop could not show a banner.
 */
export async function notify(kind: NotifyKind, title: string, body: string): Promise<void> {
  try {
    const { notifications } = await readPreferences()
    if (!notifications.enabled || !notifications[kind]) return

    send(title, summarize(body))
  } catch {
    // Deliberately swallowed.
  }
}
