import { execFile } from 'node:child_process'
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

export async function runClaude(args: string[], timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
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
    const result = await exec(claude, args, { timeout })
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
  } catch (e: any) {
    if (e.killed) {
      throw createError({
        statusCode: 504,
        data: { error: 'timeout', message: 'Operation timed out. Try again.' },
      })
    }
    const stderr = e.stderr?.trim() || e.message || 'Unknown CLI error'
    throw createError({
      statusCode: 500,
      data: { error: 'cli_error', message: stderr },
    })
  }
}
