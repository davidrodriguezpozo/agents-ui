import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/**
 * Where the Claude Code CLI commonly lives. A GUI-launched server does not
 * inherit a login shell's PATH, so probing bare `claude` alone is not enough —
 * the official installer puts it in ~/.local/bin, which is rarely on PATH here.
 */
function candidatePaths(): string[] {
  return [
    'claude',
    join(homedir(), '.local', 'bin', 'claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    join(homedir(), '.bun', 'bin', 'claude'),
    join(homedir(), '.volta', 'bin', 'claude'),
  ]
}

let cached: string | null | undefined

/** Resolve the CLI, or null when it isn't installed. Result is memoised. */
export async function findClaude(): Promise<string | null> {
  if (cached !== undefined) return cached

  for (const cmd of candidatePaths()) {
    // Skip absolute paths that plainly don't exist before paying for a spawn.
    if (cmd.startsWith('/') && !existsSync(cmd)) continue
    try {
      await exec(cmd, ['--version'], { timeout: 5_000 })
      cached = cmd
      return cached
    } catch {
      continue
    }
  }

  cached = null
  return cached
}

export async function hasClaudeCli(): Promise<boolean> {
  return (await findClaude()) !== null
}

/** Forget the memoised lookup — used after the user installs the CLI. */
export function resetClaudeLookup(): void {
  cached = undefined
}

export async function runClaude(
  args: string[],
  // Accepts a number for the callers that predate there being anything else to
  // pass. `cwd` matters for anything project-scoped — MCP servers can come from
  // a `.mcp.json` beside the code, so the answer depends on where you ask.
  opts: number | { cwd?: string; timeout?: number } = 120_000,
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, timeout = 120_000 } = typeof opts === 'number' ? { cwd: undefined, timeout: opts } : opts
  const claude = await findClaude()
  if (!claude) {
    throw createError({
      statusCode: 500,
      data: {
        error: 'cli_not_found',
        message: 'Claude Code CLI not found. Install it from claude.ai, then reload this page.',
      },
    })
  }

  try {
    const result = await collect(claude, args, { timeout, cwd })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (e: any) {
    if (e.killed) {
      throw createError({
        statusCode: 504,
        data: { error: 'timeout', message: 'Operation timed out. Try again.' },
      })
    }
    const detail = e.stderr?.trim() || reportedError(e.stdout) || e.message || 'Unknown CLI error'
    throw createError({
      statusCode: 500,
      data: { error: 'cli_error', message: detail, stdout: e.stdout?.trim() || undefined },
    })
  }
}

/**
 * The CLI's own account of a failure, dug out of stdout.
 *
 * On a `--output-format json` run the report goes to stdout and the exit code
 * goes non-zero, so the useful sentence is in the stream a caller would normally
 * ignore on failure. Without this the whole diagnosis is "exited with code 1",
 * which is what it said for a run whose real problem was named in its own output.
 *
 * Not used ahead of stderr, and not used on a plain run: there, stdout is the
 * transcript and would bury the message rather than being it.
 */
export function reportedError(stdout: unknown): string | undefined {
  if (typeof stdout !== 'string' || !stdout.trim()) return undefined

  try {
    const parsed = JSON.parse(stdout) as {
      result?: unknown
      subtype?: unknown
      error?: unknown
      is_error?: unknown
    }
    for (const field of [parsed.error, parsed.result, parsed.subtype]) {
      if (typeof field === 'string' && field.trim()) return field.trim().slice(0, 600)
    }
  } catch {
    // Not JSON — a crash, a stack trace, a usage message. The first non-empty
    // line is the most useful part of any of those.
    const line = stdout.split('\n').map(l => l.trim()).find(Boolean)
    if (line) return line.slice(0, 600)
  }

  return undefined
}

/**
 * Output big enough to be a bug rather than an answer.
 *
 * `execFile` used to impose 1MB and throw ENOBUFS past it — every other caller
 * in this codebase raises it by hand, which is a fair sign the default is wrong
 * for what we run. This is high enough not to be reached by a real reply and low
 * enough to stop a runaway stream eating the machine.
 */
const MAX_OUTPUT = 32 * 1024 * 1024

/**
 * Run the CLI with stdin closed, and collect what it says.
 *
 * `spawn` rather than `execFile` for one reason: **stdin**. `execFile` leaves
 * stdin as an open pipe that nothing ever writes to or closes, so `claude -p`
 * sits waiting for input that is not coming and eventually gives up with
 * "Warning: no stdin data received in 3s, proceeding without it". Measured on
 * the same prompt, same machine:
 *
 *   execFile                  9424ms, warning present
 *   spawn, stdin 'ignore'     6114ms, no warning
 *
 * Three and a bit seconds, on every invocation in the app — and `execFile`
 * ignores an `stdio` option because it needs its own pipes, so there was no way
 * to fix it without changing how the process is started.
 *
 * The warning itself is the second reason. It arrives on stderr, and a caller
 * reading stderr to find out what went wrong was being handed a sentence about
 * stdin on a run that had worked perfectly.
 */
function collect(
  file: string,
  args: string[],
  { cwd, timeout }: { cwd?: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      timeout,
      // The whole point. 'ignore' hands the child /dev/null, so it reads EOF
      // immediately instead of waiting to see whether anything arrives.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let overflowed = false

    const take = (into: 'out' | 'err') => (chunk: Buffer) => {
      if (overflowed) return
      if (stdout.length + stderr.length + chunk.length > MAX_OUTPUT) {
        overflowed = true
        child.kill()
        return
      }
      if (into === 'out') stdout += chunk
      else stderr += chunk
    }

    child.stdout.on('data', take('out'))
    child.stderr.on('data', take('err'))

    // A spawn that never started at all — missing binary, no permission.
    child.on('error', reject)

    child.on('close', (code, signal) => {
      if (overflowed) {
        reject(Object.assign(new Error(`The CLI produced more than ${MAX_OUTPUT} bytes.`), { stderr }))
        return
      }

      // `timeout` kills the child with a signal, which is the same shape the
      // old execFile path reported as `killed` — kept so callers still get 504.
      if (signal) {
        reject(Object.assign(new Error('Operation timed out.'), { killed: true, stderr }))
        return
      }

      if (code !== 0) {
        // stdout matters on a failure, not just stderr: with `--output-format
        // json` the CLI reports what went wrong as JSON on stdout and *still*
        // exits non-zero, so discarding it leaves the caller holding
        // "exited with code 1" and no way to find out why.
        reject(Object.assign(new Error(`The CLI exited with code ${code}.`), {
          stderr, stdout, code,
        }))
        return
      }

      resolve({ stdout, stderr })
    })
  })
}
