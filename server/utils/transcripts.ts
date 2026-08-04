import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { transcriptDirFor } from './sessionRecovery'

/**
 * Conversations you had with Claude Code in the terminal.
 *
 * Claude Code keeps one transcript per conversation, named after its session
 * id, in a directory named after the working directory. That id is all the SDK
 * needs to resume — which means a conversation started in a terminal can be
 * picked up here, in a worktree, with a diff and a merge behind it.
 *
 * Nothing here writes: these files belong to Claude Code, and adopting one
 * copies its id rather than touching it.
 */

export interface TranscriptSummary {
  /** Passing this as `resume` brings the whole conversation back. */
  sdkSessionId: string
  /** The first thing you actually said, which is what it was about. */
  title: string
  turnCount: number
  updatedAt: number
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c): c is { type: string; text: string } =>
      Boolean(c) && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map(c => c.text)
    .join(' ')
}

/**
 * What was said, ignoring everything that was not said by a person: sidechains
 * are subagent traffic, meta entries are the harness talking to itself, and a
 * tool result arrives wearing the user's role with no text of its own.
 */
export function summarizeTranscript(raw: string): { title: string | null; turnCount: number } {
  let title: string | null = null
  let turnCount = 0

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue

    let entry: { type?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (entry.type !== 'user' || entry.isSidechain || entry.isMeta) continue

    const text = textOf(entry.message?.content).trim()
    if (!text || text.startsWith('<')) continue

    turnCount += 1
    if (!title) title = text.slice(0, 120)
  }

  return { title, turnCount }
}

/**
 * Every terminal conversation held in a directory, newest first.
 *
 * Reading each file costs a pass over it, so this is capped: the ones worth
 * continuing are recent, and a year of transcripts is not a menu anybody wants.
 */
export async function listTranscripts(cwd: string, limit = 12): Promise<TranscriptSummary[]> {
  const dir = transcriptDirFor(cwd)
  if (!existsSync(dir)) return []

  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.jsonl'))

  const withTimes = await Promise.all(files.map(async (file) => {
    const info = await stat(join(dir, file)).catch(() => null)
    return { file, mtime: info?.mtimeMs ?? 0 }
  }))

  const newest = withTimes.sort((a, b) => b.mtime - a.mtime).slice(0, limit)

  const summaries = await Promise.all(newest.map(async ({ file, mtime }) => {
    const raw = await readFile(join(dir, file), 'utf-8').catch(() => '')
    const { title, turnCount } = summarizeTranscript(raw)

    return {
      sdkSessionId: file.replace(/\.jsonl$/, ''),
      title: title ?? 'Untitled conversation',
      turnCount,
      updatedAt: mtime,
    }
  }))

  // A conversation with nothing in it is a session someone opened and closed.
  return summaries.filter(s => s.turnCount > 0)
}
