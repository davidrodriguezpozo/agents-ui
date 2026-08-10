import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let currentClaudeDir: string | null = null

export function getClaudeDir(): string {
  if (!currentClaudeDir) {
    const envDir = process.env.CLAUDE_DIR
    currentClaudeDir = envDir || join(homedir(), '.claude')
  }
  return currentClaudeDir
}

export function setClaudeDir(dir: string): void {
  if (!existsSync(dir)) {
    throw createError({ statusCode: 400, message: `Directory does not exist: ${dir}` })
  }
  currentClaudeDir = dir
}

export function resolveClaudePath(...segments: string[]): string {
  return join(getClaudeDir(), ...segments)
}

/**
 * Our own corner of `~/.claude`, which does not count as it being configured.
 *
 * Everything this app stores — rituals, sessions, run history — lives under
 * this one directory, and `jsonStore` creates it the moment anything is
 * written. On a cold machine that happens during boot, before a browser has
 * connected.
 */
export const OUR_DIR = 'agents-ui'

/**
 * Whether Claude Code has actually been set up here, as opposed to the
 * directory merely existing.
 *
 * These are not the same question, and treating them as one made the welcome
 * unreachable. It appeared when `~/.claude` was absent — but the server writes
 * into `~/.claude/agents-ui` while starting, so by the time anyone could see the
 * page the directory existed and the welcome never fired. Verified in a
 * container with nothing installed: the whole directory contained `agents-ui`
 * and nothing else, and `existsSync` came back true.
 *
 * So the question is asked properly instead. Anything in there that is not ours
 * — `settings.json`, `agents`, `skills`, credentials, a `CLAUDE.md` — means
 * there is a Claude Code set-up already. Nothing but ours means there is not,
 * however many directories we have made for ourselves.
 */
export function isConfigured(dir: string = getClaudeDir()): boolean {
  if (!existsSync(dir)) return false

  try {
    return readdirSync(dir).some(entry => entry !== OUR_DIR && entry !== '.DS_Store')
  } catch {
    // Unreadable is not the same as empty, and offering to set up a directory
    // we cannot read would be the wrong offer.
    return true
  }
}
