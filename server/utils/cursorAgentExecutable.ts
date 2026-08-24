import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Which `cursor-agent` binary a Cursor run is spawned from.
 *
 * Beside `claudeExecutable.ts` rather than inside it, and that is a decision
 * rather than duplication. That file answers a question with a history — the
 * SDK's own platform packages, a 290MB native binary, a broken release — and
 * every one of its candidates is a Claude Code install location. Folding a
 * second CLI into it would mean a lookup whose comment explains one product and
 * whose list contains two, which is how the next person adds a Codex path to
 * the wrong array.
 *
 * So this is the same shape, deliberately: PATH first because it is what the
 * user chose, then the fixed locations for when PATH is the bare launchd
 * default that a GUI-launched server inherits. `~/.local/bin/cursor-agent` is
 * the installer's own destination and a symlink into a versioned directory,
 * which is why the check follows it.
 */

/** Escape hatch, mirroring `CLAUDE_CODE_EXECUTABLE`. */
export const CURSOR_EXECUTABLE_ENV = 'CURSOR_AGENT_EXECUTABLE'

export interface CursorLookup {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  home?: string
  /** Overridden in tests, which have no Cursor to find. */
  isExecutable?: (path: string) => boolean
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'cursor-agent.exe' : 'cursor-agent'
}

export function cursorInstallCandidates({
  platform = process.platform,
  env = process.env,
  home = homedir(),
}: CursorLookup = {}): string[] {
  const binary = executableName(platform)
  const fromPath = (env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map(dir => join(dir, binary))

  const wellKnown = platform === 'win32'
    ? [join(home, 'AppData', 'Local', 'Programs', 'cursor-agent', binary)]
    : [
        join(home, '.local', 'bin', binary),
        join(home, '.cursor', 'bin', binary),
        '/opt/homebrew/bin/cursor-agent',
        '/usr/local/bin/cursor-agent',
      ]

  return [...fromPath, ...wellKnown]
}

function runnable(path: string): boolean {
  try {
    // Follows the symlink: `~/.local/bin/cursor-agent` points into the version
    // directory the installer last unpacked.
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The first binary that exists and can be executed, or null when there is none. */
export function findCursorAgent(lookup: CursorLookup = {}): string | null {
  const { env = process.env, isExecutable = runnable } = lookup

  const override = env[CURSOR_EXECUTABLE_ENV]?.trim()
  // A path that was asked for and does not work is a mistake worth hearing
  // about, not something to paper over with a different binary.
  if (override) return isExecutable(override) ? override : null

  for (const candidate of cursorInstallCandidates(lookup)) {
    if (isExecutable(candidate)) return candidate
  }

  return null
}

let cached: string | null = null

/**
 * The binary every Cursor turn is spawned from. Throws rather than let the
 * spawn fail with ENOENT, which says nothing a person can act on.
 */
export function cursorAgentExecutable(): string {
  // Re-checked rather than trusted: `cursor-agent update` moves the binary the
  // symlink points at, and a resolved path that has stopped working should send
  // us looking again.
  if (cached && runnable(cached)) return cached

  cached = findCursorAgent()
  if (cached) return cached

  const override = process.env[CURSOR_EXECUTABLE_ENV]?.trim()
  throw new Error(
    override
      ? `${CURSOR_EXECUTABLE_ENV} is set to ${override}, which is not an executable file.`
      : 'Cursor was not found on this machine. Sessions on Cursor run through the cursor-agent CLI — '
        + `install it (https://cursor.com/cli), or set ${CURSOR_EXECUTABLE_ENV} to the path of the binary.`,
  )
}

/** Forget the memoised lookup — used after the user installs the CLI. */
export function resetCursorLookup(): void {
  cached = null
}
