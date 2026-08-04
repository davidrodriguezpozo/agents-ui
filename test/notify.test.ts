import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { appleScriptString, bannerText } from '../server/utils/notify'

/**
 * Notifications are the half of running-as-a-service that reaches you. Two
 * things have to hold: the text can never become part of the AppleScript
 * program, and the preferences that silence it are honoured.
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

describe('preferences', () => {
  it('starts with the actionable ones on', async () => {
    const { notifications } = await preferences.readPreferences()

    expect(notifications).toMatchObject({ enabled: true, needsYou: true, failed: true })
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
