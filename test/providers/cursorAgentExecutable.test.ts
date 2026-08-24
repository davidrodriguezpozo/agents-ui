import { describe, expect, it } from 'vitest'
import {
  CURSOR_EXECUTABLE_ENV,
  cursorInstallCandidates,
  findCursorAgent,
} from '../../server/utils/cursorAgentExecutable'

/**
 * Where `cursor-agent` is.
 *
 * The same question `claudeExecutable` answers for Claude Code, and answered
 * separately on purpose — that file's candidate list is a history of Claude Code
 * install locations, and folding a second CLI into it would mean a lookup whose
 * comment explains one product and whose list contains two.
 *
 * The case that matters is the one a GUI-launched server hits: PATH is the bare
 * launchd default, `~/.local/bin` is not on it, and the installer put the binary
 * there anyway.
 */

describe('finding cursor-agent', () => {
  it('takes what is on PATH first, because it is what the user chose', () => {
    const found = findCursorAgent({
      platform: 'darwin',
      env: { PATH: '/opt/mine/bin:/usr/bin' },
      home: '/home/dev',
      isExecutable: path => path === '/opt/mine/bin/cursor-agent',
    })

    expect(found).toBe('/opt/mine/bin/cursor-agent')
  })

  /** A background service inherits launchd's PATH, which has none of these on it. */
  it('finds the installer\'s own location when PATH does not have it', () => {
    const found = findCursorAgent({
      platform: 'darwin',
      env: { PATH: '/usr/bin:/bin' },
      home: '/home/dev',
      isExecutable: path => path === '/home/dev/.local/bin/cursor-agent',
    })

    expect(found).toBe('/home/dev/.local/bin/cursor-agent')
  })

  it('answers null when it is not installed, rather than a path that will not run', () => {
    expect(findCursorAgent({
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      home: '/home/dev',
      isExecutable: () => false,
    })).toBeNull()
  })

  it('takes the override when one is set', () => {
    expect(findCursorAgent({
      env: { [CURSOR_EXECUTABLE_ENV]: '/opt/build/cursor-agent', PATH: '/usr/bin' },
      isExecutable: path => path === '/opt/build/cursor-agent',
    })).toBe('/opt/build/cursor-agent')
  })

  /**
   * A path that was asked for and does not work is a mistake worth hearing
   * about. Quietly using a different binary would mean a run on an agent the
   * person deliberately pointed away from.
   */
  it('refuses to look elsewhere when the override does not work', () => {
    expect(findCursorAgent({
      env: { [CURSOR_EXECUTABLE_ENV]: '/opt/build/missing', PATH: '/usr/bin' },
      // Everything else on the machine works; only the override does not.
      isExecutable: path => path !== '/opt/build/missing',
    })).toBeNull()
  })

  it('looks for the .exe on Windows, and in the Windows places', () => {
    const candidates = cursorInstallCandidates({
      platform: 'win32',
      env: { PATH: 'C:\\bin' },
      home: 'C:\\Users\\dev',
    })

    expect(candidates.every(path => path.endsWith('cursor-agent.exe'))).toBe(true)
    expect(candidates.some(path => path.includes('AppData'))).toBe(true)
  })

  it('puts PATH ahead of every fixed location', () => {
    const candidates = cursorInstallCandidates({
      platform: 'darwin',
      env: { PATH: '/opt/mine/bin' },
      home: '/home/dev',
    })

    expect(candidates[0]).toBe('/opt/mine/bin/cursor-agent')
    expect(candidates).toContain('/home/dev/.local/bin/cursor-agent')
  })
})
