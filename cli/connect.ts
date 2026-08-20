import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * Finding the server, and starting one if there is nothing to find.
 *
 * The terminal app is a client, so it needs something to be listening. Usually
 * there already is: most people install the background service, because a
 * ritual due at 08:00 only fires if something is running at 08:00. When there
 * is not, starting one is better than an error telling you to open another
 * terminal and come back.
 *
 * Whatever it starts is left running afterwards, deliberately. Quitting the
 * terminal app should not stop the thing running your rituals — the same
 * reasoning that makes the service the recommended way to run this at all.
 */

/** Loopback only. The host check in `sameOrigin.ts` refuses anything else by name. */
const HOST = '127.0.0.1'

export interface Connection {
  baseUrl: string
  /** Whether this process had to start the server rather than finding one. */
  started: boolean
}

export function baseUrlFor(port: number): string {
  return `http://${HOST}:${port}`
}

/**
 * Which port to talk to.
 *
 * `--port` beats the environment so a second instance can be reached without
 * exporting anything, and `PORT` matches what `agents-studio install` bakes
 * into the service definition.
 */
export function portFrom(argv: string[], env: NodeJS.ProcessEnv): number {
  const flagIndex = argv.findIndex(arg => arg === '--port' || arg === '-p')
  const flagValue = flagIndex >= 0 ? argv[flagIndex + 1] : undefined
  const inline = argv.find(arg => arg.startsWith('--port='))?.split('=')[1]

  const candidate = Number(flagValue ?? inline ?? env.PORT)
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 3000
}

/** Is something answering, and is it this app? */
export async function answering(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/system/health', baseUrl), {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * The built server this copy can start, or null when there is nothing to start.
 *
 * Passed in by `bin/start.mjs`, which already works out whether it is running
 * from a checkout or an install and has built the thing if it had to. Resolving
 * it again here would be a second, quietly different answer to a question that
 * has already been settled once.
 */
export function serverEntry(env: NodeJS.ProcessEnv): string | null {
  const entry = env.AGENTS_STUDIO_SERVER_ENTRY
  return entry && existsSync(entry) ? entry : null
}

export interface ConnectOptions {
  baseUrl: string
  entry: string | null
  /** How long to wait for a server this process started to answer. */
  withinMs?: number
  onStarting?: () => void
}

/**
 * Connect, starting a server first if nothing is listening.
 *
 * Detached and with its output discarded, so the server outlives this process
 * and cannot scribble on the screen the terminal app is drawing. Both matter:
 * an attached child would die with the TUI, and a child sharing stdout would
 * corrupt every frame Ink renders.
 */
export async function connect(options: ConnectOptions): Promise<Connection> {
  const { baseUrl, entry, withinMs = 30_000, onStarting } = options

  if (await answering(baseUrl)) return { baseUrl, started: false }

  if (!entry) {
    throw new Error(
      `Nothing is answering on ${baseUrl}, and this copy has no build to start.\n`
      + 'Start the server yourself with `agents-studio`, or install it with `agents-studio install`.',
    )
  }

  onStarting?.()

  const port = new URL(baseUrl).port || '3000'
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: port, HOST },
  })
  child.unref()

  if (await waitUntilAnswering(baseUrl, withinMs)) return { baseUrl, started: true }

  throw new Error(
    `Started a server for ${baseUrl}, but it did not answer within ${Math.round(withinMs / 1000)}s.\n`
    + 'Run `agents-studio status` to see what it is saying.',
  )
}

async function waitUntilAnswering(baseUrl: string, withinMs: number): Promise<boolean> {
  const deadline = Date.now() + withinMs
  while (Date.now() < deadline) {
    if (await answering(baseUrl, 1000)) return true
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return false
}
