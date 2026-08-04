import { describe, expect, it } from 'vitest'
// Plain JS on purpose: the installer has to run before anything is built.
import {
  escapeXml,
  plistFor,
  portFromDefinition,
  serviceEnvironment,
  supervisorFor,
  systemdUnitFor,
} from '../bin/service.mjs'

/**
 * The service definition is generated once and then read by launchd or systemd
 * at 08:00 with nobody watching, so a mistake here is invisible until a ritual
 * silently never fires.
 */

const definition = {
  nodePath: '/usr/local/bin/node',
  serverPath: '/repo/.output/server/index.mjs',
  workingDir: '/repo',
  logPath: '/home/me/.claude/agents-ui/logs/service.log',
  environment: { PATH: '/usr/bin:/bin', PORT: '3000', HOST: '0.0.0.0' },
}

describe('the environment a service gets', () => {
  it('carries the PATH from the shell that installed it', () => {
    // launchd hands over a bare PATH with no `claude` in it, so every run would
    // fail with "command not found" at 08:00.
    const env = serviceEnvironment({ port: 3000, host: '0.0.0.0', path: '/opt/homebrew/bin:/usr/bin' })

    expect(env.PATH).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('leaves the Claude directory unpinned unless one was chosen', () => {
    const env = serviceEnvironment({ port: 3000, host: '0.0.0.0', path: '/usr/bin' })

    expect(env).not.toHaveProperty('CLAUDE_DIR')
  })

  it('pins the Claude directory when one was', () => {
    const env = serviceEnvironment({ port: 3000, host: '0.0.0.0', path: '/usr/bin', claudeDir: '/tmp/demo' })

    expect(env.CLAUDE_DIR).toBe('/tmp/demo')
  })

  it('writes the port as a string, since that is all these files hold', () => {
    expect(serviceEnvironment({ port: 3200, host: '0.0.0.0', path: '/usr/bin' }).PORT).toBe('3200')
  })
})

describe('the launchd definition', () => {
  it('starts at login and comes back after a crash', () => {
    const plist = plistFor(definition)

    expect(plist).toContain('<key>RunAtLoad</key>\n    <true/>')
    expect(plist).toContain('<key>KeepAlive</key>\n    <true/>')
  })

  it('runs this node against this build', () => {
    const plist = plistFor(definition)

    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<string>/repo/.output/server/index.mjs</string>')
  })

  it('sends both streams to one log, so a crash leaves a trail', () => {
    const plist = plistFor(definition)

    expect(plist).toContain('<key>StandardOutPath</key>')
    expect(plist).toContain('<key>StandardErrorPath</key>')
    expect(plist.match(/service\.log/g)).toHaveLength(2)
  })

  it('escapes a path that would otherwise break the XML', () => {
    // A repository checked out under "Tom & Jerry" is enough to produce a
    // plist launchd refuses to parse, and the failure is silent.
    const plist = plistFor({ ...definition, workingDir: '/Users/me/Tom & Jerry/repo' })

    expect(plist).toContain('/Users/me/Tom &amp; Jerry/repo')
    expect(plist).not.toContain('Tom & Jerry')
  })

  it('escapes every character XML reserves', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;')
  })
})

describe('the systemd definition', () => {
  it('restarts rather than staying dead', () => {
    const unit = systemdUnitFor(definition)

    expect(unit).toContain('Restart=always')
  })

  it('starts with the user session', () => {
    expect(systemdUnitFor(definition)).toContain('WantedBy=default.target')
  })

  it('passes each environment variable through', () => {
    const unit = systemdUnitFor(definition)

    expect(unit).toContain('Environment=PATH=/usr/bin:/bin')
    expect(unit).toContain('Environment=PORT=3000')
  })
})

describe('reading back the port it was installed on', () => {
  it('finds it in a plist', () => {
    // Installing with PORT=3001 pins 3001; asking about 3000 afterwards would
    // report a perfectly healthy service as down.
    const plist = plistFor({ ...definition, environment: { ...definition.environment, PORT: '3001' } })

    expect(portFromDefinition(plist)).toBe(3001)
  })

  it('finds it in a systemd unit', () => {
    const unit = systemdUnitFor({ ...definition, environment: { ...definition.environment, PORT: '4100' } })

    expect(portFromDefinition(unit)).toBe(4100)
  })

  it('says so when the definition names no port', () => {
    expect(portFromDefinition('<plist></plist>')).toBeNull()
  })
})

describe('picking a supervisor', () => {
  it('knows the two it can drive, and admits when it cannot', () => {
    expect(supervisorFor('darwin')).toBe('launchd')
    expect(supervisorFor('linux')).toBe('systemd')
    expect(supervisorFor('win32')).toBeNull()
  })
})
