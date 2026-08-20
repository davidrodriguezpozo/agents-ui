#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, cpSync, statSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import {
  LABEL,
  UNIT_NAME,
  plistFor,
  plistPath,
  portFromDefinition,
  serviceEnvironment,
  supervisorFor,
  systemdUnitFor,
  systemdUnitPath,
} from './service.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const outputServer = resolve(root, '.output', 'server', 'index.mjs')

const port = Number(process.env.PORT) || 3000
/**
 * Loopback by default.
 *
 * This app starts sessions and rituals that run commands as you, with your
 * Claude credentials, against your repositories — and it has no authentication
 * of any kind. Bound to every interface, anyone who can reach this port owns
 * all of that. Reaching it from your phone is a real thing to want, so it is
 * still one environment variable away, but it has to be asked for.
 */
const host = process.env.HOST || '127.0.0.1'
const exposed = host !== '127.0.0.1' && host !== 'localhost'
const claudeDir = process.env.CLAUDE_DIR || join(homedir(), '.claude')
const logPath = join(claudeDir, 'agents-ui', 'logs', 'service.log')

/**
 * The service runs from its own copy of the build, not from `.output`.
 *
 * `.output` belongs to whoever is developing: `bun run build` empties it and
 * rewrites it over about a minute, and a server running out of it dies on the
 * next chunk it tries to load. Installing is therefore a deploy — the build is
 * copied here and the service is pointed at the copy, so working on the code
 * cannot take down the thing running your rituals.
 */
const installedBuild = join(claudeDir, 'agents-ui', 'installed-build')
const installedServer = join(installedBuild, 'server', 'index.mjs')

const supervisor = supervisorFor()
const definitionPath = supervisor === 'launchd' ? plistPath() : systemdUnitPath()

/** Present when running from the repository rather than from an install. */
const fromSource = existsSync(resolve(root, 'nuxt.config.ts'))

/** This package's own version, for saying which one is running. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')).version || null
  } catch {
    return null
  }
}

/**
 * An installed copy ships its build; only a checkout can make one.
 *
 * Falling through to `npx nuxi build` in an installed package would go looking
 * for source that is not there and a toolchain that was never installed, then
 * fail somewhere deep in Nuxt. If the build is missing from an install, the
 * package is broken and saying so is the only useful thing left to do.
 */
function ensureBuilt() {
  if (existsSync(outputServer)) return

  if (!fromSource) {
    console.error('This copy of agents-studio has no build in it, which should be impossible.')
    console.error('Reinstall it:  npm install -g agents-studio')
    process.exit(1)
  }

  console.log('Building agents-studio...')
  execSync('npx nuxi build', { cwd: root, stdio: 'inherit' })
}

/** Run a command, and say whether it worked rather than pretending it did. */
function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'pipe' })
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message || '').trim() }
  }
}

function quiet(command, args) {
  return run(command, args).ok
}

/**
 * What this build was cut from, left beside it for the running server to read.
 *
 * A deployed build is a snapshot, so it can fall behind the repository without
 * anything on screen changing. Recording the commit is what lets the app say
 * so rather than leaving you to wonder why a fix you just made is not there.
 */
function writeBuildInfo(target) {
  const read = (args) => {
    try {
      return execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim()
    } catch {
      return ''
    }
  }

  const sha = fromSource ? read(['rev-parse', 'HEAD']) : ''

  // Installed from npm there is no repository to be behind, so the useful
  // thing to record is which release this is. Without it the app reported
  // "running from source" to someone who has no source at all.
  if (!sha) {
    const version = packageVersion()
    if (!version) return

    writeFileSync(join(target, 'build-info.json'), `${JSON.stringify({
      version,
      deployedAt: Date.now(),
    }, null, 2)}\n`, 'utf-8')
    return
  }

  writeFileSync(join(target, 'build-info.json'), `${JSON.stringify({
    sha,
    subject: read(['log', '-1', '--format=%s']),
    committedAt: Number(read(['log', '-1', '--format=%ct'])) * 1000 || null,
    deployedAt: Date.now(),
    repoDir: root,
  }, null, 2)}\n`, 'utf-8')
}

/** Whoever already has the port, in a form worth putting on screen. */
function portHolder(target) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${target}`, '-sTCP:LISTEN'], { stdio: 'pipe' })
      .toString()
      .trim()
      .split('\n')
      .slice(1)
    if (!out.length) return null
    const [command, pid] = out[0].split(/\s+/)
    return `${command} (pid ${pid})`
  } catch {
    return null
  }
}

/** Can we actually bind it? The only question that matters before installing. */
function portIsFree(target) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(target, '0.0.0.0')
  })
}

async function answering(target, timeoutMs = 2000) {
  try {
    const response = await fetch(`http://127.0.0.1:${target}/api/system/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Stopping a service is not instant, and the replacement cannot bind until the
 * old one has actually let go. Without this the reinstall races itself: the new
 * process starts, fails to bind, and is restarted into a wall until the install
 * gives up on a service that was only ever a second early.
 */
async function waitForPortFree(target, withinMs = 8_000) {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (await portIsFree(target)) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return portIsFree(target)
}

/** Give it a moment to boot before deciding it failed. */
async function waitUntilAnswering(target, withinMs = 15_000) {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (await answering(target, 1000)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

function stopExisting() {
  if (supervisor === 'launchd') {
    quiet('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`])
  } else if (supervisor === 'systemd') {
    quiet('systemctl', ['--user', 'stop', UNIT_NAME])
  }
}

function tailLog(lines = 12) {
  if (!existsSync(logPath)) return ''
  return readFileSync(logPath, 'utf-8').trimEnd().split('\n').slice(-lines).join('\n')
}

async function install() {
  if (!supervisor) {
    console.error(`No background service support for ${process.platform} yet.`)
    console.error(`Run it yourself with: PORT=${port} node bin/start.mjs`)
    process.exit(1)
  }

  // A service pointed at a build that does not exist would crash-loop quietly.
  ensureBuilt()
  mkdirSync(dirname(logPath), { recursive: true })

  // The copy being replaced is holding its own port, which is not a clash. Any
  // other occupant is, and stopping a working service to find that out would
  // leave you with neither.
  const replacingOurselves = existsSync(definitionPath)
    && portFromDefinition(readFileSync(definitionPath, 'utf-8')) === port

  if (replacingOurselves) {
    stopExisting()
    await waitForPortFree(port)
  }

  if (!await portIsFree(port)) {
    const holder = portHolder(port)
    console.error(`Port ${port} is already taken${holder ? ` — by ${holder}` : ''}.`)
    console.error('')
    console.error('Installed as it is, the service would start, fail to bind, and be')
    console.error('restarted forever. Pick another port or free this one:')
    console.error('')
    console.error('    make service PORT=3001')
    if (!replacingOurselves) console.error('')
    if (!replacingOurselves) console.error('Nothing has been changed.')
    process.exit(1)
  }

  // Only now is it safe to displace whatever was registered before.
  stopExisting()
  await waitForPortFree(port)

  const environment = serviceEnvironment({
    port,
    host,
    // Only pinned if you asked for one; otherwise the service reads whatever
    // ~/.claude is, exactly like running it by hand.
    claudeDir: process.env.CLAUDE_DIR,
    path: process.env.PATH,
  })

  // Take the copy only once the port is known to be free, so a refusal leaves
  // the previously deployed build exactly as it was.
  rmSync(installedBuild, { recursive: true, force: true })
  cpSync(resolve(root, '.output'), installedBuild, { recursive: true })
  writeBuildInfo(installedBuild)

  const definition = {
    nodePath: process.execPath,
    serverPath: installedServer,
    workingDir: installedBuild,
    logPath,
    environment,
  }

  mkdirSync(dirname(definitionPath), { recursive: true })

  if (supervisor === 'launchd') {
    writeFileSync(definitionPath, plistFor(definition), 'utf-8')

    const domain = `gui/${process.getuid()}`
    let started = run('launchctl', ['bootstrap', domain, definitionPath])
    // Older macOS releases only understand the deprecated spelling.
    if (!started.ok) started = run('launchctl', ['load', '-w', definitionPath])

    if (!started.ok) {
      console.error(`launchctl refused to start it: ${started.error}`)
      process.exit(1)
    }
  } else {
    writeFileSync(definitionPath, systemdUnitFor(definition), 'utf-8')

    quiet('systemctl', ['--user', 'daemon-reload'])
    const started = run('systemctl', ['--user', 'enable', '--now', UNIT_NAME])
    if (!started.ok) {
      console.error(`systemctl refused to start it: ${started.error}`)
      process.exit(1)
    }
  }

  // Registered is not the same as working, and only one of them is any use.
  if (!await waitUntilAnswering(port)) {
    console.error(`Installed, but nothing is answering on port ${port}.`)
    console.error('')
    console.error(tailLog() || `Nothing in ${logPath} yet.`)
    console.error('')
    console.error(`Undo it with: node bin/start.mjs uninstall`)
    process.exit(1)
  }

  console.log(`Installed and running on http://localhost:${port}`)
  console.log(`  definition  ${definitionPath}`)
  console.log(`  running     its own copy of the build, so rebuilding cannot disturb it`)
  console.log(exposed
    ? `  reachable   on ${host} — ANYONE on your network can run commands as you`
    : '  reachable   from this machine only')
  console.log(`  logs        ${logPath}`)
  if (supervisor === 'systemd') {
    console.log('  note        systemctl --user services stop at logout unless you run:')
    console.log(`                loginctl enable-linger ${process.env.USER || ''}`)
  }
  console.log('')
  console.log('Rituals will now run whether or not you have this open.')
  console.log('Remove it again with: node bin/start.mjs uninstall')
}

function uninstall() {
  if (supervisor === 'launchd') {
    quiet('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`])
    quiet('launchctl', ['unload', '-w', definitionPath])
    if (existsSync(definitionPath)) rmSync(definitionPath)
    rmSync(installedBuild, { recursive: true, force: true })
    console.log(`Removed ${LABEL}. Your sessions, rituals and history are untouched.`)
  } else if (supervisor === 'systemd') {
    quiet('systemctl', ['--user', 'disable', '--now', UNIT_NAME])
    if (existsSync(definitionPath)) rmSync(definitionPath)
    rmSync(installedBuild, { recursive: true, force: true })
    quiet('systemctl', ['--user', 'daemon-reload'])
    console.log(`Removed ${UNIT_NAME}. Your sessions, rituals and history are untouched.`)
  } else {
    console.log('Nothing to remove — no service was ever installed on this platform.')
  }
}

async function status() {
  let registered = false

  if (supervisor === 'launchd') {
    registered = quiet('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`])
  } else if (supervisor === 'systemd') {
    registered = quiet('systemctl', ['--user', 'is-active', '--quiet', UNIT_NAME])
  }

  // Ask about the port it was installed on, not the one this shell happens to
  // default to — otherwise a service on 3001 reports as down.
  const installedPort = existsSync(definitionPath)
    ? portFromDefinition(readFileSync(definitionPath, 'utf-8')) ?? port
    : port

  const up = await answering(installedPort)

  // Which build it is actually serving, which is not necessarily the one you
  // last compiled.
  const deployed = existsSync(installedServer)
    ? new Date(statSync(installedServer).mtimeMs).toLocaleString()
    : null

  console.log(`service    ${registered ? 'installed' : 'not installed'}`)
  if (deployed) console.log(`build      deployed ${deployed}`)
  console.log(`responding ${up ? `yes — http://localhost:${installedPort}` : `no on port ${installedPort}`}`)
  console.log(`logs       ${existsSync(logPath) ? logPath : '(none yet)'}`)

  if (registered && !up) {
    const holder = portHolder(installedPort)
    console.log('')
    if (holder) console.log(`Port ${installedPort} is held by ${holder}.`)
    console.log(tailLog(8) || 'Nothing in the log yet.')
  }
}

function start() {
  ensureBuilt()
  process.env.PORT = String(port)
  process.env.HOST = host

  // Running in the foreground writes no deploy note, so this is the only way
  // the server can know it is a release rather than a checkout.
  if (!fromSource) {
    const version = packageVersion()
    if (version) process.env.AGENTS_STUDIO_VERSION = version
  }

  console.log(`Starting agents-studio on http://localhost:${port}`)
  if (exposed) {
    console.log(`Bound to ${host}: anyone on your network can reach this, and it has no password.`)
  }
  return import(outputServer)
}

const outputCli = resolve(root, '.output', 'cli', 'index.mjs')

function ensureCliBuilt() {
  if (existsSync(outputCli)) return

  if (!fromSource) {
    console.error('This copy of agents-studio has no terminal app in it.')
    console.error('Reinstall it:  npm install -g agents-studio')
    process.exit(1)
  }

  ensureBuilt()
  if (existsSync(outputCli)) return
  console.log('Building the terminal app...')
  execSync('node scripts/build-cli.mjs', { cwd: root, stdio: 'inherit' })
}

/**
 * Everything the client side of this can do, handed to the bundled CLI.
 *
 * The launcher's job is to know whether this is a checkout or an install and to
 * have built what it needs; deciding what `work --json` means is the CLI's, and
 * it parses the rest of the arguments itself.
 */
const CLIENT_COMMANDS = new Set(['tui', 'work', 'land', 'daily', 'fleet', 'inbox', 'new', 'watch'])

function client() {
  ensureBuilt()
  ensureCliBuilt()
  process.env.AGENTS_STUDIO_SERVER_ENTRY = outputServer
  return import(outputCli)
}

const command = process.argv[2]

if (command === 'install') await install()
else if (command === 'uninstall') uninstall()
else if (command === 'status') await status()
else if (CLIENT_COMMANDS.has(command)) await client()
else if (command === 'help' || command === '--help' || command === '-h') {
  console.log('agents-studio              start the server in the foreground')
  console.log('agents-studio tui          the same app, in this terminal')
  console.log('agents-studio work         what is in flight, and what wants you')
  console.log('agents-studio land         pull requests with your name on them')
  console.log('agents-studio daily        rituals: when they fire, how they went')
  console.log('agents-studio fleet        everything running, and what today cost')
  console.log('agents-studio inbox        what is waiting elsewhere')
  console.log('agents-studio new <text>   start a session on it')
  console.log('agents-studio watch        follow what happens, a line at a time')
  console.log('agents-studio install      run in the background, at login and after a crash')
  console.log('agents-studio uninstall    stop doing that')
  console.log('agents-studio status       is it installed, is it answering')
  console.log('')
  console.log('Any client command takes --json, --quiet, --project DIR and --port N.')
  console.log('They exit 2 when something is waiting on you, so a shell can branch on it.')
} else await start()
