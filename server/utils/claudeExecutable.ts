import { accessSync, constants, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Which `claude` binary a run is spawned from.
 *
 * The SDK used to answer this itself and it cost a broken release to find out
 * that it no longer can. Up to 0.2.x the CLI shipped *inside*
 * `@anthropic-ai/claude-agent-sdk` as plain JavaScript, so Nitro's file tracing
 * saw an ordinary import, copied `cli.js` into `.output`, and the published
 * package really was self-contained. From 0.3.x the CLI is a ~290MB per-platform
 * native binary in an optional dependency, found at runtime with
 * `require.resolve('@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')`.
 * Tracing cannot see a dynamic resolve, and 290MB per platform has no business
 * in an npm tarball either — so the vendored build has `sdk.mjs` and nothing to
 * spawn, and every run in an installed copy died on
 *
 *     Native CLI binary for darwin-arm64 not found.
 *
 * while development carried on working, because a checkout has the platform
 * package sitting in `node_modules` where the SDK looks for it.
 *
 * So the path is resolved here and passed explicitly. In a checkout that finds
 * the same binary the SDK would have; in an install it finds the Claude Code
 * the machine already has — which is not a new requirement, since this app has
 * never been able to do anything without a logged-in Claude Code anyway.
 */

/** Escape hatch, for a binary in none of the usual places. */
export const EXECUTABLE_ENV = 'CLAUDE_CODE_EXECUTABLE'

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk'

const requireFromHere = createRequire(import.meta.url)

export interface Lookup {
  platform?: NodeJS.Platform
  arch?: string
  env?: Record<string, string | undefined>
  home?: string
  /** Overridden in tests, which have no Claude Code to find. */
  isExecutable?: (path: string) => boolean
  /** Overridden in tests; `require.resolve`, which throws when it fails. */
  resolvePackage?: (specifier: string) => string
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude'
}

/**
 * Alpine and friends need the musl build, and a glibc binary spawned there
 * fails looking for a dynamic loader that is not installed. Node reports which
 * libc it was itself linked against, which is the same answer.
 */
function preferMusl(): boolean {
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined
    return !report?.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

/**
 * The SDK's own optional dependencies, in the order it tries them — see `b1` in
 * `sdk.mjs`. Kept in step deliberately: when the platform package is present,
 * the binary handed to the SDK should be the one it would have picked itself.
 */
export function platformPackages(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl: boolean = preferMusl(),
): string[] {
  const specifiers = platform === 'android'
    ? [`${SDK_PACKAGE}-linux-${arch}-android`]
    : platform === 'linux'
      ? musl
        ? [`${SDK_PACKAGE}-linux-${arch}-musl`, `${SDK_PACKAGE}-linux-${arch}`]
        : [`${SDK_PACKAGE}-linux-${arch}`, `${SDK_PACKAGE}-linux-${arch}-musl`]
      : [`${SDK_PACKAGE}-${platform}-${arch}`]

  return specifiers.map(specifier => `${specifier}/${executableName(platform)}`)
}

/**
 * Where a Claude Code install puts its binary, best first. Every entry is an
 * absolute path: a bare `claude` would leave the SDK's own "does this exist"
 * check with nothing to look at.
 *
 * PATH comes first because it is what the user chose, and the background
 * service runs with the PATH from the shell it was installed from — captured
 * for exactly this kind of reason. The fixed locations after it are for when
 * that PATH is the bare launchd default: `~/.local/bin` is the native
 * installer, `~/.claude/local` the older local install, the rest are the
 * package managers people install it with.
 *
 * Shared with `findClaude` in `cli.ts`, which asks the same question for a
 * different reason — one list, so a new install location is only ever added
 * once.
 */
export function installCandidates({
  platform = process.platform,
  env = process.env,
  home = homedir(),
}: Lookup = {}): string[] {
  const binary = executableName(platform)
  const fromPath = (env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map(dir => join(dir, binary))

  const wellKnown = platform === 'win32'
    ? [join(home, 'AppData', 'Local', 'Programs', 'claude', binary)]
    : [
        join(home, '.local', 'bin', binary),
        join(home, '.claude', 'local', binary),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        join(home, '.bun', 'bin', binary),
        join(home, '.volta', 'bin', binary),
      ]

  return [...fromPath, ...wellKnown]
}

function runnable(path: string): boolean {
  try {
    // `statSync` follows the symlink: `~/.local/bin/claude` points at the
    // version directory the installer last unpacked.
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * The first binary that exists and can be executed, or null if there is none.
 */
export function findClaudeExecutable(lookup: Lookup = {}): string | null {
  const {
    platform = process.platform,
    arch = process.arch,
    env = process.env,
    isExecutable = runnable,
    resolvePackage = (specifier: string) => requireFromHere.resolve(specifier),
  } = lookup

  const override = env[EXECUTABLE_ENV]?.trim()
  // A path that was asked for and does not work is a mistake worth hearing
  // about, not something to quietly paper over with a different binary.
  if (override) return isExecutable(override) ? override : null

  for (const specifier of platformPackages(platform, arch)) {
    try {
      const resolved = resolvePackage(specifier)
      if (isExecutable(resolved)) return resolved
    } catch {
      // Not installed for this platform — expected in an installed copy.
    }
  }

  for (const candidate of installCandidates({ platform, env, home: lookup.home })) {
    if (isExecutable(candidate)) return candidate
  }

  return null
}

let cached: string | null = null

/**
 * The binary every `query()` is spawned from. Throws rather than let the SDK
 * fail later with a message about reinstalling a package the user never
 * installed.
 */
export function claudeExecutable(): string {
  // Re-checked rather than trusted: Claude Code updates itself underneath us,
  // and a resolved path that has stopped working should send us looking again.
  if (cached && runnable(cached)) return cached

  cached = findClaudeExecutable()
  if (cached) return cached

  const override = process.env[EXECUTABLE_ENV]?.trim()
  throw new Error(
    override
      ? `${EXECUTABLE_ENV} is set to ${override}, which is not an executable file.`
      : 'Claude Code was not found on this machine. Agents Studio runs your agents through the Claude Code CLI '
        + 'rather than shipping a copy of it — install it (https://claude.com/download), or set '
        + `${EXECUTABLE_ENV} to the path of the binary.`,
  )
}
