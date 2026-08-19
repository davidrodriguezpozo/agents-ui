import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appleScriptString, bannerText, runPath, studioUrl } from '../server/utils/notify'
import { NOTIFIER_BUNDLE_ID, notifierEntry, notifierPlist, stalePendingNames } from '../server/utils/notifier'

/**
 * Notifications are the half of running-as-a-service that reaches you. Three
 * things have to hold: the text can never become part of the AppleScript
 * program, the preferences that silence it are honoured, and clicking one
 * arrives somewhere — which is what the app bundle in `notifier.ts` is for.
 */

let dir: string
let preferences: typeof import('../server/utils/preferences')

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-prefs-'))
  process.env.CLAUDE_DIR = dir
  preferences = await import('../server/utils/preferences')
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
})

describe('text going into AppleScript', () => {
  it('escapes a quote, which would otherwise end the string early', () => {
    // `display notification "..."` has no parameter binding: the text is part
    // of the program, so an unescaped quote is code.
    expect(appleScriptString('the "big" one')).toBe('the \\"big\\" one')
  })

  it('escapes backslashes before they can escape something else', () => {
    expect(appleScriptString('C:\\path')).toBe('C:\\\\path')
  })

  it('flattens newlines, which cannot appear in the literal at all', () => {
    expect(appleScriptString('one\ntwo\r\nthree')).toBe('one two three')
  })

  it('survives an attempt to close the string and run something', () => {
    const escaped = appleScriptString('" & (do shell script "whoami") & "')

    expect(escaped).not.toMatch(/(^|[^\\])"/)
  })
})

describe('what the banner says', () => {
  it('strips the markdown a run writes, which reads as noise in a banner', () => {
    // Punctuation the writer meant, like the dash, stays.
    expect(bannerText('## Overnight\n\n**CI** — green')).toBe('Overnight CI — green')
  })

  it('trims to something a banner can show', () => {
    const long = 'word '.repeat(80)

    expect(bannerText(long).length).toBeLessThanOrEqual(120)
    expect(bannerText(long).endsWith('…')).toBe(true)
  })

  it('leaves a short line alone', () => {
    expect(bannerText('Nothing needs you.')).toBe('Nothing needs you.')
  })
})

describe('where a banner takes you', () => {
  const port = process.env.PORT
  const host = process.env.HOST

  afterEach(() => {
    if (port === undefined) delete process.env.PORT
    else process.env.PORT = port
    if (host === undefined) delete process.env.HOST
    else process.env.HOST = host
  })

  it('uses the port this server was actually started on', () => {
    // A service installed on 3001 and notifying about 3000 sends you to
    // whatever else is listening there, or to nothing at all.
    process.env.PORT = '3001'

    expect(studioUrl('/sessions/abc')).toBe('http://127.0.0.1:3001/sessions/abc')
  })

  it('sends you to loopback when the server is bound to everything', () => {
    // `0.0.0.0` is where it listens, not an address a browser can open.
    process.env.HOST = '0.0.0.0'
    process.env.PORT = '3000'

    expect(studioUrl()).toBe('http://127.0.0.1:3000/')
  })

  it('keeps a real host, which is how a phone reaches it', () => {
    process.env.HOST = '192.168.1.20'
    process.env.PORT = '3000'

    expect(studioUrl('/schedules')).toBe('http://192.168.1.20:3000/schedules')
  })

  it('reads a turn in its session and anything else on its own page', () => {
    expect(runPath({ id: 'run-1', sessionId: 'sess-9' })).toBe('/sessions/sess-9')
    expect(runPath({ id: 'run-1' })).toBe('/runs/run-1')
  })
})

describe('what the applet is handed', () => {
  it('keeps the title and the link to a line each, so it can be read back', () => {
    // The applet takes line 1 as the title, line 2 as the link and the rest as
    // the body: a newline in either of the first two would shift the others.
    const entry = notifierEntry('One\ntitle', 'http://127.0.0.1:3000/runs/x', 'The body.')

    expect(entry.split('\n').slice(0, 3)).toEqual([
      'One title',
      'http://127.0.0.1:3000/runs/x',
      'The body.',
    ])
  })

  it('needs no escaping, because the text is never part of the program', () => {
    const entry = notifierEntry('the "big" one', '/', 'C:\\path & "quotes"')

    expect(entry).toContain('the "big" one')
    expect(entry).toContain('C:\\path & "quotes"')
  })
})

describe('the notifier bundle', () => {
  const plist = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<plist version="1.0">',
    '<dict>',
    '\t<key>CFBundleExecutable</key>',
    '\t<string>applet</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n')

  it('gives the applet an identity of its own', () => {
    // Without this key the banner is Script Editor's: its icon, its settings,
    // and a click that opens an empty script window.
    const patched = notifierPlist(plist)

    expect(patched).toContain(`<key>CFBundleIdentifier</key>`)
    expect(patched).toContain(`<string>${NOTIFIER_BUNDLE_ID}</string>`)
    expect(patched).toContain('<key>LSUIElement</key>')
    expect(patched.indexOf('CFBundleIdentifier')).toBeLessThan(patched.indexOf('</dict>'))
  })

  it('does not state a key twice, which would not be a plist at all', () => {
    const once = notifierPlist(plist)
    const twice = notifierPlist(once)

    expect(twice).toBe(once)
  })

  it('sweeps a queue nothing ever came to read', () => {
    // Where there is no desktop the launch succeeds and the applet never runs.
    // Without the sweep, a machine that got its desktop back would show every
    // banner it had ever missed, all at once.
    const now = 1_700_000_000_000
    const names = [
      `${now - 6 * 60_000}-11-0`,
      `${now - 1000}-11-1`,
      'written-by-something-else',
    ]

    expect(stalePendingNames(names, now)).toEqual([
      `${now - 6 * 60_000}-11-0`,
      'written-by-something-else',
    ])
  })
})

describe('preferences', () => {
  it('starts with the actionable ones on', async () => {
    const { notifications } = await preferences.readPreferences()

    expect(notifications).toMatchObject({ enabled: true, needsYou: true, failed: true })
  })

  it('posts from the browser unless asked otherwise', async () => {
    // The browser is the only sender whose click can come back to the tab you
    // already had, which is the whole reason it is the default.
    const { notifications } = await preferences.readPreferences()

    expect(notifications.channel).toBe('browser')
  })

  it('keeps a channel that was chosen', async () => {
    await preferences.savePreferences({ channel: 'both' })
    const { notifications } = await preferences.readPreferences()

    expect(notifications.channel).toBe('both')
  })

  it('ignores a channel that does not exist rather than storing it', async () => {
    // A hand-edited file must not leave `notify` switching on a value none of
    // its branches match, which would be silence with nothing to explain it.
    expect(preferences.sanitiseChannel('carrier-pigeon')).toBe('browser')
    expect(preferences.sanitiseChannel(undefined)).toBe('browser')
  })

  it('keeps what was set and defaults the rest', async () => {
    await preferences.savePreferences({ finished: false })
    const { notifications } = await preferences.readPreferences()

    expect(notifications.finished).toBe(false)
    expect(notifications.needsYou).toBe(true)
  })

  it('falls back to the defaults rather than failing a run', async () => {
    // Unlike sessions or rituals, nothing here is worth stopping work over.
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(join(dir, 'agents-ui'), { recursive: true })
    await writeFile(join(dir, 'agents-ui', 'preferences.json'), 'not json', 'utf-8')

    await expect(preferences.readPreferences()).resolves.toEqual(preferences.DEFAULT_PREFERENCES)
  })
})
