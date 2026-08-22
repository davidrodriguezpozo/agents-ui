import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, connect } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import { defineJsonStore } from './jsonStore'
import { detectPackageManager, makefileHasTarget } from './checks'
import { startPreviewProxy, type PreviewProxy } from './previewProxy'

/**
 * Running the thing and looking at it.
 *
 * The last reason to leave: a diff tells you what changed and the checks tell
 * you whether it still passes, and neither answers "does it look right". So you
 * open a terminal, start the dev server, and go to localhost — which is three
 * steps outside an app built so you would not have to.
 *
 * Each session gets its own server on its own port, because the whole point of
 * worktrees is that several run at once, and two dev servers fighting over 3000
 * is exactly the thrash the check queue already exists to prevent.
 */

function readIfPresent(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf-8') : null
  } catch {
    return null
  }
}

export interface DetectedDev {
  command: string
  /** What in the repository this was inferred from, so the guess is auditable. */
  from: string
}

/**
 * A reasonable guess at how this project runs.
 *
 * `dev` before `start` because `start` is as often "run the built thing" as it
 * is "run it for development", and the second is what somebody reviewing a
 * session actually wants.
 */
export function detectDevCommand(repoDir: string): DetectedDev | null {
  const makefile = readIfPresent(join(repoDir, 'Makefile')) ?? readIfPresent(join(repoDir, 'makefile'))
  if (makefile && makefileHasTarget(makefile, 'dev')) {
    return { command: 'make dev', from: 'the `dev` target in your Makefile' }
  }

  const raw = readIfPresent(join(repoDir, 'package.json'))
  if (raw) {
    let scripts: Record<string, string> = {}
    try {
      scripts = JSON.parse(raw).scripts ?? {}
    } catch {
      scripts = {}
    }

    const pm = detectPackageManager(repoDir)
    if (scripts.dev) return { command: `${pm} run dev`, from: 'the `dev` script in package.json' }
    if (scripts.serve) return { command: `${pm} run serve`, from: 'the `serve` script in package.json' }
    if (scripts.start) return { command: `${pm} run start`, from: 'the `start` script in package.json' }
  }

  return null
}

/**
 * The dev command per repository, kept out of the project's own tracked
 * settings for the same reason the check command is: what your machine runs
 * should not arrive in somebody else's `git pull` as policy.
 */
export type ProjectDev = Record<string, string>

export const projectDevStore = defineJsonStore<ProjectDev>({
  label: 'project dev commands',
  path: () => join(getClaudeDir(), 'agents-ui', 'project-dev.json'),
  empty: () => ({}),
  decode: parsed => parsed?.projects ?? {},
  encode: projects => ({ version: 1, projects }),
})

export interface ResolvedDev {
  command: string
  source: 'configured' | 'detected'
  from?: string
}

/** Never throws: an unreadable config means falling back to a guess. */
export async function devCommandFor(repoDir: string | undefined): Promise<ResolvedDev | null> {
  if (!repoDir) return null

  let configured: string | undefined
  try {
    configured = (await projectDevStore.read())[repoDir]
  } catch {
    configured = undefined
  }

  // Explicitly emptied: this project says it has nothing to run.
  if (configured === '') return null
  if (configured) return { command: configured, source: 'configured' }

  const detected = detectDevCommand(repoDir)
  return detected ? { command: detected.command, source: 'detected', from: detected.from } : null
}

export async function setDevCommand(repoDir: string, command: string): Promise<string> {
  return projectDevStore.update((projects) => {
    const next = command.trim()
    projects[repoDir] = next
    return next
  })
}

export async function clearDevCommand(repoDir: string): Promise<void> {
  await projectDevStore.update((projects) => {
    delete projects[repoDir]
  })
}

// --- Running one -------------------------------------------------------------

export type PreviewState = 'starting' | 'ready' | 'failed' | 'stopped'

export interface Preview {
  sessionId: string
  command: string
  port: number
  state: PreviewState
  /** The tail of what it printed — enough to see why it did not start. */
  output: string
  startedAt: number
  child: ChildProcess
  /**
   * The port the iframe should actually load — the dev server with the element
   * picker added to it. Null when the proxy would not start, in which case the
   * preview still works and the picker says why it does not.
   */
  pickerPort: number | null
  proxy: PreviewProxy | null
}

const previews = new Map<string, Preview>()

/** Beyond this the output is scroll, not evidence. */
const MAX_OUTPUT = 8000

/**
 * How long to wait for something to answer on the port.
 *
 * A cold Vite start is a couple of seconds; a Next build can be thirty. Ninety
 * is generous enough that a slow project is not called broken, and short enough
 * that a command which will never listen — a test runner, a REPL — gives up
 * rather than spinning forever.
 */
export const READY_TIMEOUT_MS = 90_000

/** A port nothing else is on, chosen by asking the kernel rather than guessing. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

/** Whether anything is listening yet. */
export function portAnswers(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (answer: boolean) => {
      socket.destroy()
      resolve(answer)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
    socket.on('timeout', () => done(false))
  })
}

export function getPreview(sessionId: string): Preview | undefined {
  return previews.get(sessionId)
}

/**
 * Start the project's dev command in this session's workspace.
 *
 * The port is handed over in the environment, which is what every dev server in
 * this class reads. A project that ignores `PORT` and hardcodes one will
 * collide with itself across sessions — worth saying in the UI rather than
 * pretending to have solved.
 */
export async function startPreview(
  sessionId: string,
  cwd: string,
  command: string,
): Promise<Preview> {
  stopPreview(sessionId)

  const port = await freePort()
  const child = spawn('/bin/sh', ['-c', command], {
    cwd,
    env: { ...process.env, PORT: String(port), FORCE_COLOR: '0', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    /**
     * Its own process group, and this is not optional.
     *
     * A dev command is nearly always a shell running a package manager running
     * the real server, so stopping it means signalling the whole group. Without
     * `detached` the child shares *this* process group — and `kill(-pid)` would
     * then signal the server itself, taking the app down every time somebody
     * pressed Stop.
     */
    detached: true,
  })

  /*
   * Started with the server rather than when Point mode is switched on, so that
   * switching it on does not change the iframe's URL — which would reload the
   * page and lose whatever state somebody had navigated to in order to point at
   * something. The script it adds does nothing until asked.
   */
  const proxy = await startPreviewProxy(port).catch(() => null)

  const preview: Preview = {
    sessionId,
    command,
    port,
    state: 'starting',
    output: '',
    startedAt: Date.now(),
    child,
    pickerPort: proxy?.port ?? null,
    proxy,
  }

  const collect = (chunk: Buffer) => {
    preview.output = (preview.output + chunk.toString('utf-8')).slice(-MAX_OUTPUT)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  child.on('exit', (code) => {
    // Exiting before anything answered is a failure to start; exiting after is
    // just a server that was stopped, however it happened.
    preview.state = preview.state === 'ready' ? 'stopped' : 'failed'
    if (preview.state === 'failed' && code) {
      preview.output += `\n[exited with ${code}]`
    }
  })

  child.on('error', (e) => {
    preview.state = 'failed'
    preview.output += `\n[could not start: ${e.message}]`
  })

  previews.set(sessionId, preview)

  // Watch for the port in the background; the caller gets the record now so the
  // UI can show "starting" rather than blocking on a cold build.
  void (async () => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (preview.state === 'failed' || preview.state === 'stopped') return
      if (await portAnswers(port)) {
        preview.state = 'ready'
        return
      }
      await new Promise(r => setTimeout(r, 400))
    }

    if (preview.state === 'starting') {
      preview.state = 'failed'
      preview.output += `\n[nothing answered on port ${port} after ${Math.round(READY_TIMEOUT_MS / 1000)}s]`
      stopPreview(sessionId, { keepRecord: true })
    }
  })()

  return preview
}

/**
 * Stop it, and everything it started.
 *
 * Killed as a process group: a dev command is nearly always a shell running a
 * package manager running the actual server, and killing the shell alone leaves
 * the server holding the port — which then makes the next start pick a
 * different one and quietly leak the old.
 */
export function stopPreview(sessionId: string, opts: { keepRecord?: boolean } = {}): void {
  const preview = previews.get(sessionId)
  if (!preview) return

  preview.proxy?.close()
  preview.proxy = null
  preview.pickerPort = null

  try {
    if (preview.child.pid) process.kill(-preview.child.pid, 'SIGTERM')
  } catch {
    try {
      preview.child.kill('SIGTERM')
    } catch {
      // Already gone, which is the outcome asked for.
    }
  }

  if (opts.keepRecord) preview.state = preview.state === 'ready' ? 'stopped' : preview.state
  else previews.delete(sessionId)
}

export function stopAllPreviews(): void {
  for (const id of [...previews.keys()]) stopPreview(id)
}
