import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function findClaude(): Promise<string> {
  // Try common locations
  for (const cmd of ['claude', '/usr/local/bin/claude', '/opt/homebrew/bin/claude']) {
    try {
      await exec(cmd, ['--version'], { timeout: 5_000 })
      return cmd
    } catch {
      continue
    }
  }
  throw createError({
    statusCode: 500,
    data: { error: 'cli_not_found', message: 'Claude Code CLI is required. Install it from claude.ai' },
  })
}

export async function runClaude(args: string[], timeout = 120_000): Promise<{ stdout: string; stderr: string }> {
  const claude = await findClaude()
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
    // CLI exited with non-zero — return stderr as the error
    const stderr = e.stderr?.trim() || e.message || 'Unknown CLI error'
    throw createError({
      statusCode: 500,
      data: { error: 'cli_error', message: stderr },
    })
  }
}
