/**
 * Running Agent Manager as a background service.
 *
 * Rituals are the reason this exists. "The result is waiting when you get in"
 * is only true if something was running at 08:00 — and a server you started in
 * a terminal yesterday is not that. This registers the app with the operating
 * system's own supervisor, so it starts at login and comes back if it dies.
 *
 * The generators below are pure so they can be tested without installing
 * anything: nothing here touches launchd or systemd until `install()` runs.
 */

import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const LABEL = 'com.agents-ui.server'
export const UNIT_NAME = 'agents-ui'

/**
 * XML has five characters that cannot appear raw in a plist string.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The environment a run actually needs.
 *
 * A service does not inherit your shell's environment: launchd hands over a
 * bare `/usr/bin:/bin:/usr/sbin:/sbin`, which has no `claude` and no `gh` in
 * it. Every run would fail with "command not found" at 08:00 with nobody
 * watching. So the PATH in force at install time is captured and written into
 * the service definition — this is why installing from your normal shell
 * matters.
 *
 * @param {{ port: number | string, host: string, claudeDir?: string, path?: string }} options
 * @returns {Record<string, string>}
 */
export function serviceEnvironment({ port, host, claudeDir, path }) {
  const env = {
    PATH: path,
    PORT: String(port),
    HOST: host,
  }
  // Only pinned when explicitly chosen, so the default stays "wherever
  // ~/.claude is for whoever is logged in".
  if (claudeDir) env.CLAUDE_DIR = claudeDir
  return env
}

/**
 * @param {{ nodePath: string, serverPath: string, workingDir: string, logPath: string, environment: Record<string, string> }} definition
 * @returns {string}
 */
export function plistFor({ nodePath, serverPath, workingDir, logPath, environment }) {
  const envEntries = Object.entries(environment)
    .map(([key, value]) => `      <key>${escapeXml(key)}</key>\n      <string>${escapeXml(value)}</string>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${escapeXml(LABEL)}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(nodePath)}</string>
      <string>${escapeXml(serverPath)}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${envEntries}
    </dict>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workingDir)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
  </dict>
</plist>
`
}

/**
 * @param {{ nodePath: string, serverPath: string, workingDir: string, environment: Record<string, string> }} definition
 * @returns {string}
 */
export function systemdUnitFor({ nodePath, serverPath, workingDir, environment }) {
  const envLines = Object.entries(environment)
    .map(([key, value]) => `Environment=${key}=${value}`)
    .join('\n')

  return `[Unit]
Description=Agent Manager for Claude Code
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${serverPath}
WorkingDirectory=${workingDir}
${envLines}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

export function plistPath(home = homedir()) {
  return join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

export function systemdUnitPath(home = homedir()) {
  return join(home, '.config', 'systemd', 'user', `${UNIT_NAME}.service`)
}

/**
 * Which supervisor to talk to, or null when we have nothing to offer.
 * @param {string} [os]
 * @returns {'launchd' | 'systemd' | null}
 */
export function supervisorFor(os = platform()) {
  if (os === 'darwin') return 'launchd'
  if (os === 'linux') return 'systemd'
  return null
}
