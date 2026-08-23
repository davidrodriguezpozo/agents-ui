import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { readMcpToken } from './mcpAccess'
import { SERVER_NAME } from './mcpServer'

const exec = promisify(execFile)

/**
 * Writing this app into a project's `.mcp.json`, instead of asking somebody to.
 *
 * Being an MCP server was unit 05, and it shipped with a hole nobody could see
 * from the code: the only way in was `curl -s localhost:3000/api/mcp/token`,
 * reading the JSON it printed, and pasting it into a file by hand. Every part of
 * that works and the whole of it is a wall — a feature reached by a `curl` is a
 * feature for the person who wrote it.
 *
 * The awkward part is not the writing. It is that **the config contains a bearer
 * token and `.mcp.json` is usually tracked**, so the obvious implementation
 * commits a secret to a shared repository on somebody's behalf. That is the one
 * thing this must not do, so:
 *
 *   - **A tracked `.mcp.json` is refused, in words.** Not written to with a
 *     warning afterwards — refused, with the two ways forward said out loud.
 *     By the time a warning is read the token is already in the index.
 *   - **An untracked one is written *and* excluded**, through
 *     `.git/info/exclude` — per clone, never committed, the same mechanism this
 *     app already uses to hide `.worktrees/`. So the file cannot become a commit
 *     by accident later, including by a `git add .` somebody else runs.
 *   - **Other servers are preserved.** A project's `.mcp.json` is usually the
 *     team's, listing servers that have nothing to do with this app. Ours is one
 *     key in it; everything else is copied through untouched.
 *   - **An unparseable file is refused rather than replaced.** Somebody is
 *     mid-edit, or it is a template with comments in it. Overwriting to fix our
 *     own convenience is the worst available outcome.
 */

/** The file, relative to the repository, as everybody refers to it. */
export const MCP_CONFIG = '.mcp.json'

export interface McpConnectResult {
  ok: boolean
  /** The absolute file that was written, when one was. */
  path?: string
  created?: boolean
  /** Whether the entry replaced one that was already there. */
  replaced?: boolean
  /** Other servers left exactly as they were. */
  kept?: string[]
  /** True when `.git/info/exclude` gained the entry as part of this. */
  excluded?: boolean
  /** Why nothing was written. Present exactly when `ok` is false. */
  refusal?: { error: string; message: string }
}

/** Whether git is tracking this path — the question that decides everything. */
export async function isTracked(repoDir: string, relative: string): Promise<boolean> {
  try {
    await exec('git', ['ls-files', '--error-unmatch', '--', relative], { cwd: repoDir, timeout: 10_000 })
    return true
  } catch {
    // Not tracked, or not a repository at all. Both mean "safe to write and
    // exclude", and the second is checked separately before excluding.
    return false
  }
}

/**
 * Hide `.mcp.json` from git without touching a tracked file.
 *
 * `.git/info/exclude` is per clone and never committed, so this cannot appear in
 * anybody's diff or fight a shared `.gitignore` — the same reasoning as
 * `excludeWorktreeDir`, which is where this pattern comes from.
 */
export async function excludeMcpConfig(repoDir: string): Promise<boolean> {
  const gitDir = await exec('git', ['rev-parse', '--git-common-dir'], { cwd: repoDir, timeout: 10_000 })
    .then(({ stdout }) => stdout.trim())
    .catch(() => '')

  if (!gitDir) return false

  const path = join(isAbsolute(gitDir) ? gitDir : join(repoDir, gitDir), 'info', 'exclude')
  const existing = await readFile(path, 'utf8').catch(() => '')
  if (existing.split('\n').some(line => line.trim() === MCP_CONFIG)) return true

  await mkdir(dirname(path), { recursive: true })
  const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
  await appendFile(
    path,
    `${prefix}\n# Holds this machine's token for the Agents Studio tool server\n${MCP_CONFIG}\n`,
    'utf8',
  )

  return true
}

/** The entry this app is, in a `.mcp.json`. */
export function serverEntry(url: string, token: string): Record<string, unknown> {
  return {
    type: 'http',
    url,
    headers: { Authorization: `Bearer ${token}` },
  }
}

/**
 * Merge our entry into whatever is there, or say why not.
 *
 * Pure over the file's text so the merge — the part that could damage somebody
 * else's config — is testable without a disk.
 */
export function mergeConfig(
  existing: string,
  url: string,
  token: string,
): { text: string; replaced: boolean; kept: string[] } | { refusal: string } {
  let parsed: Record<string, unknown> = {}

  if (existing.trim()) {
    try {
      const raw = JSON.parse(existing)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { refusal: `${MCP_CONFIG} does not contain a JSON object. Nothing has been changed.` }
      }
      parsed = raw as Record<string, unknown>
    } catch (e) {
      return {
        refusal: `${MCP_CONFIG} could not be parsed (${(e as Error).message}), so it has been left `
          + 'alone. Fix or move it, then try again.',
      }
    }
  }

  const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return { refusal: `The \`mcpServers\` key in ${MCP_CONFIG} is not an object. Nothing has been changed.` }
  }

  const kept = Object.keys(servers).filter(name => name !== SERVER_NAME)
  const replaced = SERVER_NAME in servers

  const next = {
    ...parsed,
    mcpServers: { ...servers, [SERVER_NAME]: serverEntry(url, token) },
  }

  // Two spaces and a trailing newline: this is a file people read and edit, and
  // on the tracked-elsewhere day it is a file people diff.
  return { text: `${JSON.stringify(next, null, 2)}\n`, replaced, kept }
}

/**
 * Put this app in a project's `.mcp.json`, safely, or refuse and say why.
 *
 * The refusals are the feature. Each one names the thing to do instead, because
 * the alternative — pasting four lines of JSON — is still perfectly good and is
 * what the panel offers underneath the button.
 */
export async function connectProject(repoDir: string, url: string): Promise<McpConnectResult> {
  const path = join(repoDir, MCP_CONFIG)

  if (await isTracked(repoDir, MCP_CONFIG)) {
    return {
      ok: false,
      refusal: {
        error: 'tracked',
        message: `${MCP_CONFIG} is tracked by git here, and the entry contains this machine's `
          + 'token — writing it would put a secret in your next commit. Copy it in by hand and '
          + 'keep it out of the commit, or untrack the file first.',
      },
    }
  }

  const existing = existsSync(path) ? await readFile(path, 'utf8').catch(() => '') : ''
  const merged = mergeConfig(existing, url, await readMcpToken())

  if ('refusal' in merged) {
    return { ok: false, refusal: { error: 'unreadable', message: merged.refusal } }
  }

  try {
    await writeFile(path, merged.text, 'utf8')
  } catch (e: any) {
    return {
      ok: false,
      refusal: { error: 'write_failed', message: `Could not write ${path}: ${e?.message ?? 'unknown reason'}` },
    }
  }

  return {
    ok: true,
    path,
    created: !existing,
    replaced: merged.replaced,
    kept: merged.kept,
    // After the write, so a file that could not be written is never excluded.
    excluded: await excludeMcpConfig(repoDir).catch(() => false),
  }
}
