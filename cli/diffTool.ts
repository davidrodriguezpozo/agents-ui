import { execFileSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { existsSync } from 'node:fs'

/**
 * Somebody else's diff renderer, if they have one.
 *
 * A person who has installed `delta` has already decided how a diff should look,
 * and a terminal app that ignores that in favour of its own three colours is
 * reimplementing a worse version of a thing they chose. Same argument as
 * `$EDITOR`, one layer out: compose with the tools that are there.
 *
 * The built-in colouring stays for the machines that have none of them, and
 * `AGENTS_STUDIO_DIFF=none` turns the whole thing off.
 */

export interface DiffTool {
  command: string
  /** Arguments before the width, which each of them spells differently. */
  args: (width: number) => string[]
}

const KNOWN: Record<string, DiffTool> = {
  delta: {
    command: 'delta',
    args: width => [
      '--color=always',
      '--paging=never',
      `--width=${width}`,
      // Line numbers are a second gutter next to the one the app already draws,
      // and side-by-side does not survive being embedded in a pane.
      '--line-numbers=false',
      '--side-by-side=false',
    ],
  },
  'diff-so-fancy': { command: 'diff-so-fancy', args: () => [] },
  bat: {
    command: 'bat',
    args: width => ['--language=diff', '--color=always', '--paging=never', '--style=plain', `--terminal-width=${width}`],
  },
}

/** Is it on `PATH`? Asked here rather than by spawning and catching. */
export function onPath(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (command.includes('/')) return existsSync(command)
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  return dirs.some(dir => existsSync(join(dir, command)))
}

/**
 * Which renderer to use: what was asked for, then whatever is installed, then
 * none — which means the app colours it.
 */
export function pickDiffTool(env: NodeJS.ProcessEnv = process.env): DiffTool | null {
  const wanted = env.AGENTS_STUDIO_DIFF?.trim()

  if (wanted === 'none') return null
  if (wanted) {
    const known = KNOWN[wanted]
    if (known && onPath(known.command, env)) return known
    // A command with its own flags: `AGENTS_STUDIO_DIFF="delta --features=x"`.
    const [command, ...args] = wanted.split(/\s+/)
    return command && onPath(command, env) ? { command, args: () => args } : null
  }

  for (const name of ['delta', 'diff-so-fancy', 'bat']) {
    const tool = KNOWN[name]!
    if (onPath(tool.command, env)) return tool
  }

  return null
}

/**
 * Render a patch through the tool, or return null and let the caller colour it.
 *
 * Synchronous on purpose: it runs once per diff poll on a string already in
 * memory, and a promise here would mean a frame drawn without it first.
 */
export function renderPatch(patch: string, width: number, tool: DiffTool | null): string[] | null {
  if (!tool || !patch.trim()) return null

  try {
    const out = execFileSync(tool.command, tool.args(width), {
      input: patch,
      encoding: 'utf8',
      timeout: 4_000,
      maxBuffer: 8 * 1024 * 1024,
      // Its own colour decisions, not this terminal's guess about a pipe.
      env: { ...process.env, FORCE_COLOR: '1', TERM: process.env.TERM || 'xterm-256color' },
    })
    return out.replace(/\n$/, '').split('\n')
  } catch {
    // A missing binary, a timeout, a version with different flags: the built-in
    // colouring is right there and a diff is too important to fail over this.
    return null
  }
}

/**
 * Where each file starts in output somebody else rendered.
 *
 * `tab` jumps by file, and the line numbers for that come from the raw patch —
 * which no longer line up once `delta` has added headers and dropped the `---`
 * lines. Rather than guess at a mapping, find each path in the rendered text in
 * order: every one of these tools prints the filename at the top of its section,
 * because that is the one thing a diff has to say.
 *
 * A path that cannot be found gets no anchor rather than a wrong one, and the
 * caller falls back to scrolling.
 */
export function anchorsFor(lines: string[], paths: string[]): number[] {
  const anchors: number[] = []
  let from = 0

  for (const path of paths) {
    const at = lines.findIndex((line, index) => index >= from && line.includes(path))
    if (at === -1) continue
    anchors.push(at)
    from = at + 1
  }

  return anchors
}
