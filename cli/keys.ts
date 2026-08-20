import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Your keys, if you have opinions about them — and a vim user does.
 *
 * `~/.claude/agents-studio/keys.json` is `{ "session.checks": "C" }`: a binding
 * id and what to press. The keymap is already data, so this is a file read
 * rather than a feature; the help page and the footers print whatever they find
 * here, because they read the same binding the handler does.
 *
 * A broken file is ignored rather than fatal. Losing a remap is a small
 * disappointment; refusing to start over a stray comma is a big one.
 */

export interface KeyOverrides {
  overrides: Record<string, string>
  /** Where they came from, and what was wrong, for the help page to admit. */
  path: string
  error?: string
}

export function keysPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_DIR || join(env.HOME || homedir(), '.claude')
  return join(dir, 'agents-studio', 'keys.json')
}

export function loadKeyOverrides(env: NodeJS.ProcessEnv = process.env): KeyOverrides {
  const path = keysPath(env)
  if (!existsSync(path)) return { overrides: {}, path }

  try {
    return { overrides: readOverrides(readFileSync(path, 'utf8')), path }
  } catch (error) {
    return { overrides: {}, path, error: (error as Error).message }
  }
}

/**
 * The mapping, with anything that is not an id-to-key pair dropped.
 *
 * Kept separate from the file read so the parsing has a test that does not
 * involve a filesystem.
 */
export function readOverrides(text: string): Record<string, string> {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('keys.json should be an object of binding ids to keys')
  }

  const overrides: Record<string, string> = {}
  for (const [id, press] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof press === 'string' && press.trim()) overrides[id] = press.trim()
  }
  return overrides
}
