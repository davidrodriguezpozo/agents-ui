#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { homedir } from 'node:os'
import {
  LABEL,
  UNIT_NAME,
  plistFor,
  plistPath,
  serviceEnvironment,
  supervisorFor,
  systemdUnitFor,
  systemdUnitPath,
} from './service.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outputServer = resolve(root, '.output', 'server', 'index.mjs')

const port = process.env.PORT || 3000
const host = process.env.HOST || '0.0.0.0'
const claudeDir = process.env.CLAUDE_DIR || join(homedir(), '.claude')
const logPath = join(claudeDir, 'agents-ui', 'logs', 'service.log')

function ensureBuilt() {
  if (existsSync(outputServer)) return
  console.log('Building agents-ui...')
  execSync('npx nuxi build', { cwd: root, stdio: 'inherit' })
}

function quiet(command, args) {
  try {
    execFileSync(command, args, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function install() {
  const supervisor = supervisorFor()
  if (!supervisor) {
    console.error(`No background service support for ${process.platform} yet.`)
    console.error(`Run it yourself with: PORT=${port} npx agents-ui`)
    process.exit(1)
  }

  // A service pointed at a build that does not exist would crash-loop quietly.
  ensureBuilt()
  mkdirSync(dirname(logPath), { recursive: true })

  const environment = serviceEnvironment({
    port,
    host,
    // Only pinned if you asked for one; otherwise the service reads whatever
    // ~/.claude is, exactly like running it by hand.
    claudeDir: process.env.CLAUDE_DIR,
    path: process.env.PATH,
  })

  const definition = {
    nodePath: process.execPath,
    serverPath: outputServer,
    workingDir: root,
    logPath,
    environment,
  }

  if (supervisor === 'launchd') {
    const target = plistPath()
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, plistFor(definition), 'utf-8')

    const domain = `gui/${process.getuid()}`
    // Idempotent: a reinstall replaces whatever was registered before.
    quiet('launchctl', ['bootout', `${domain}/${LABEL}`])
    if (!quiet('launchctl', ['bootstrap', domain, target])) {
      // Older macOS releases only understand the deprecated spelling.
      quiet('launchctl', ['load', '-w', target])
    }
    console.log(`Installed ${LABEL}`)
    console.log(`  definition  ${target}`)
  } else {
    const target = systemdUnitPath()
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, systemdUnitFor(definition), 'utf-8')

    quiet('systemctl', ['--user', 'daemon-reload'])
    quiet('systemctl', ['--user', 'enable', '--now', UNIT_NAME])
    console.log(`Installed ${UNIT_NAME}`)
    console.log(`  definition  ${target}`)
    console.log('  note        systemctl --user services stop at logout unless you run:')
    console.log(`                loginctl enable-linger ${process.env.USER || ''}`)
  }

  console.log(`  logs        ${logPath}`)
  console.log(`  address     http://localhost:${port}`)
  console.log('')
  console.log('Rituals will now run whether or not you have this open.')
  console.log('Remove it again with: npx agents-ui uninstall')
}

function uninstall() {
  const supervisor = supervisorFor()

  if (supervisor === 'launchd') {
    const target = plistPath()
    quiet('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`])
    quiet('launchctl', ['unload', '-w', target])
    if (existsSync(target)) rmSync(target)
    console.log(`Removed ${LABEL}. Your sessions, rituals and history are untouched.`)
  } else if (supervisor === 'systemd') {
    const target = systemdUnitPath()
    quiet('systemctl', ['--user', 'disable', '--now', UNIT_NAME])
    if (existsSync(target)) rmSync(target)
    quiet('systemctl', ['--user', 'daemon-reload'])
    console.log(`Removed ${UNIT_NAME}. Your sessions, rituals and history are untouched.`)
  } else {
    console.log('Nothing to remove — no service was ever installed on this platform.')
  }
}

async function status() {
  const supervisor = supervisorFor()
  let registered = false

  if (supervisor === 'launchd') {
    registered = quiet('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`])
  } else if (supervisor === 'systemd') {
    registered = quiet('systemctl', ['--user', 'is-active', '--quiet', UNIT_NAME])
  }

  // Registered and actually answering are different questions, and only the
  // second one means your rituals will fire.
  let answering = false
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/system/health`, {
      signal: AbortSignal.timeout(2000),
    })
    answering = response.ok
  } catch {
    answering = false
  }

  console.log(`service    ${registered ? 'installed' : 'not installed'}`)
  console.log(`responding ${answering ? `yes — http://localhost:${port}` : `no on port ${port}`}`)
  console.log(`logs       ${existsSync(logPath) ? logPath : '(none yet)'}`)

  if (registered && !answering) {
    console.log('')
    console.log('Installed but not answering — the log above usually says why.')
  }
}

function start() {
  ensureBuilt()
  process.env.PORT = String(port)
  process.env.HOST = host
  console.log(`Starting agents-ui on http://localhost:${port}`)
  return import(outputServer)
}

const command = process.argv[2]

if (command === 'install') install()
else if (command === 'uninstall') uninstall()
else if (command === 'status') await status()
else if (command === 'help' || command === '--help') {
  console.log('agents-ui              start in the foreground')
  console.log('agents-ui install      run in the background, at login and after a crash')
  console.log('agents-ui uninstall    stop doing that')
  console.log('agents-ui status       is it installed, is it answering')
} else await start()
