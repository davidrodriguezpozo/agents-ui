import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { getClaudeDir } from './claudeDir'
import type { Session } from './sessions'
import { currentBranch, mergeBase } from './worktrees'

/**
 * Rebuilding a session from what survived it.
 *
 * The session index is one file. A worktree is a directory, a branch, and a
 * transcript — three independent things that outlive it. So a lost or damaged
 * index should never mean lost work: everything needed to reconstruct the
 * record is still on disk, and offering to restore it is a far better answer
 * than offering to delete what is left.
 */

/**
 * Claude Code keeps one transcript directory per working directory, naming it
 * after the path with every `/` and `.` replaced by `-`.
 */
export function transcriptDirFor(cwd: string): string {
  return join(getClaudeDir(), 'projects', cwd.replace(/[/.]/g, '-'))
}

export interface TranscriptMeta {
  /** Passing this as `resume` brings the whole conversation back. */
  sdkSessionId: string
  title: string | null
  turnCount: number
  updatedAt: number
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c): c is { type: string; text: string } =>
      Boolean(c) && typeof c === 'object' && (c as any).type === 'text')
    .map(c => c.text)
    .join(' ')
}

/**
 * The newest transcript for a working directory. Its filename is the SDK
 * session id, and its first real user message is what the session was about —
 * a much better title than anything the branch name can be squeezed back into.
 */
export async function readTranscriptMeta(cwd: string): Promise<TranscriptMeta | null> {
  const dir = transcriptDirFor(cwd)
  if (!existsSync(dir)) return null

  const files = (await readdir(dir).catch(() => [] as string[])).filter(f => f.endsWith('.jsonl'))
  if (!files.length) return null

  const withTimes = await Promise.all(files.map(async (file) => {
    const info = await stat(join(dir, file)).catch(() => null)
    return { file, mtime: info?.mtimeMs ?? 0 }
  }))
  const newest = withTimes.sort((a, b) => b.mtime - a.mtime)[0]!

  const raw = await readFile(join(dir, newest.file), 'utf-8').catch(() => '')
  if (!raw) return null

  let title: string | null = null
  let turnCount = 0

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let entry: any
    try { entry = JSON.parse(line) } catch { continue }

    // Sidechains are subagent traffic, and meta entries are the harness talking
    // to itself — neither is something the user said.
    if (entry.type !== 'user' || entry.isSidechain || entry.isMeta) continue

    const text = textOf(entry.message?.content).trim()
    // Tool results arrive as user-role entries with no text of their own.
    if (!text || text.startsWith('<')) continue

    turnCount += 1
    if (!title) title = text.slice(0, 120)
  }

  return {
    sdkSessionId: newest.file.replace(/\.jsonl$/, ''),
    title,
    turnCount,
    updatedAt: newest.mtime,
  }
}

/** Last resort when there is no transcript: unpick the branch name. */
/**
 * A session id as this app makes them: lowercase alphanumeric, never hyphenated
 * (`msnr2w23ne1i`). The distinction matters because `id` is a directory basename,
 * and for a worktree this app did not create that basename is the branch's own
 * last segment — so `fix/authorization-gaps` in a directory of the same name had
 * its entire meaning stripped as if it were an id, and was titled "Fix/".
 */
function looksLikeSessionId(id: string): boolean {
  return /^[a-z0-9]+$/.test(id)
}

/** So a directory containing `.` or `+` cannot change what the pattern means. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function titleFromBranch(branch: string, id: string): string {
  const withoutId = looksLikeSessionId(id)
    ? branch.replace(new RegExp(`-?${escapeRegExp(id)}$`), '')
    : branch

  const slug = withoutId
    .replace(/^agents-ui\//, '')
    // Any other prefix is meaning rather than noise: `fix/` and `refactor/` say
    // what the branch is for, and a slash in the middle of a sentence reads as
    // the accident it is.
    .replace(/\//g, ' ')
    .replace(/-+/g, ' ')
    .trim()

  if (!slug || slug === 'session') return 'Recovered session'
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

export interface RecoveryCandidate {
  /** Taken from the directory name, which is how sessions were laid out. */
  id: string
  title: string
  branch: string
  worktreePath: string
  sdkSessionId?: string
  /** Conversation turns found in the transcript — 0 means nothing was said. */
  turnCount: number
  /** False for a worktree git still tracks but whose directory is gone. */
  exists: boolean
  /**
   * Whether there is a conversation to bring back, as opposed to a directory.
   *
   * `exists` answers a question about the filesystem and was being read as an
   * answer about recovery — so twelve worktrees on a real machine were counted
   * as twelve lost sessions and the panel offered to restore conversations that
   * had never happened. None of them had a transcript, and their branch names
   * (`fix/authorization-gaps`) were not this app's slug-plus-id shape, so they
   * were never its sessions at all: foreign worktrees living in its directory.
   *
   * They are still worth showing — several carried more than a dozen unmerged
   * commits — but as a branch nothing here owns, not as a session to resume.
   * A resume needs the id; without it `recoveredSessionFrom` produces a session
   * with an empty conversation, which is a fine thing to offer and the wrong
   * thing to promise.
   */
  hasConversation: boolean
}

export async function inspectForRecovery(
  worktreePath: string,
  branch: string,
): Promise<RecoveryCandidate> {
  const id = basename(worktreePath)
  const transcript = await readTranscriptMeta(worktreePath)

  return {
    id,
    title: transcript?.title || titleFromBranch(branch, id),
    branch,
    worktreePath,
    sdkSessionId: transcript?.sdkSessionId,
    turnCount: transcript?.turnCount ?? 0,
    exists: existsSync(worktreePath),
    // The id is what `resume` needs, so it is the only honest test. A transcript
    // with zero turns is a file that exists and a conversation that does not.
    hasConversation: Boolean(transcript?.sdkSessionId && transcript.turnCount > 0),
  }
}

/**
 * Reconstruct the record. The base is taken as the merge base with the repo's
 * current branch rather than guessed, so diffs against it are correct even if
 * the base has moved on since the session started.
 */
export async function recoveredSessionFrom(
  repoDir: string,
  candidate: RecoveryCandidate,
): Promise<Session> {
  const baseBranch = await currentBranch(repoDir)
  const baseSha = await mergeBase(repoDir, baseBranch, candidate.branch)
  const now = Date.now()

  return {
    id: candidate.id,
    title: candidate.title,
    repoDir,
    worktreePath: candidate.worktreePath,
    branch: candidate.branch,
    baseBranch,
    baseSha,
    status: 'idle',
    sdkSessionId: candidate.sdkSessionId,
    runIds: [],
    createdAt: now,
    updatedAt: now,
    recoveredAt: now,
  }
}
