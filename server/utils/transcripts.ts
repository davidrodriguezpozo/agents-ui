import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
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
 * These files belong to Claude Code. Nothing here changes one: adopting a
 * conversation copies it into the workspace the session runs in, because that
 * is where the SDK looks for it, and leaves the original alone.
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
 * Put the conversation where the SDK will look for it.
 *
 * Claude Code finds a conversation to resume by looking in the transcript
 * directory for the working directory it is running in. An adopted session
 * runs in a worktree, and the conversation it is continuing was held in the
 * repository — a different directory, so a different transcript directory, so
 * `resume` fails with "no conversation found" and the whole point of adopting
 * is lost on the first turn.
 *
 * Copying it across is what makes the session resumable. The original is left
 * exactly as it was: the terminal conversation still belongs to the repository
 * and can still be continued there.
 */
export async function copyTranscriptTo(
  fromCwd: string,
  toCwd: string,
  sdkSessionId: string,
): Promise<boolean> {
  const source = join(transcriptDirFor(fromCwd), `${sdkSessionId}.jsonl`)
  if (!existsSync(source)) return false

  const targetDir = transcriptDirFor(toCwd)
  await mkdir(targetDir, { recursive: true })
  await copyFile(source, join(targetDir, `${sdkSessionId}.jsonl`))

  return true
}

/** Copy it across only if it is not already there. Cheap enough to always ask. */
export async function ensureTranscriptFor(
  fromCwd: string,
  toCwd: string,
  sdkSessionId: string,
): Promise<boolean> {
  if (existsSync(join(transcriptDirFor(toCwd), `${sdkSessionId}.jsonl`))) return true
  return copyTranscriptTo(fromCwd, toCwd, sdkSessionId)
}

export interface TranscriptMessage {
  role: 'user' | 'assistant'
  text: string
  at?: number
}

/** Enough of a long answer to read, without shipping an essay per message. */
const MAX_MESSAGE = 4_000

/**
 * The conversation itself, for a session that adopted one.
 *
 * Without this an adopted session opens blank: its history is real and
 * resumable, but it lives in Claude Code's transcript rather than in any run
 * this app recorded, so there is nothing on screen to show for it.
 *
 * Thinking blocks are left out. They were not addressed to anyone, and reading
 * back someone's private reasoning as though it were the reply is wrong.
 */
export async function readTranscriptMessages(
  cwd: string,
  sdkSessionId: string,
  limit = 40,
): Promise<TranscriptMessage[]> {
  const file = join(transcriptDirFor(cwd), `${sdkSessionId}.jsonl`)
  if (!existsSync(file)) return []

  const raw = await readFile(file, 'utf-8').catch(() => '')
  const messages: TranscriptMessage[] = []

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue

    let entry: {
      type?: string
      isSidechain?: boolean
      isMeta?: boolean
      timestamp?: string
      message?: { content?: unknown }
    }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (entry.isSidechain || entry.isMeta) continue
    if (entry.type !== 'user' && entry.type !== 'assistant') continue

    const text = textOf(entry.message?.content).trim()
    // Tool results wear the user's role and carry no words of their own.
    if (!text || (entry.type === 'user' && text.startsWith('<'))) continue

    const at = entry.timestamp ? Date.parse(entry.timestamp) : undefined

    messages.push({
      role: entry.type,
      text: text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}\n\n…` : text,
      at: Number.isFinite(at) ? at : undefined,
    })
  }

  // The end of a long conversation is the part you need to carry on from.
  return messages.slice(-limit)
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
