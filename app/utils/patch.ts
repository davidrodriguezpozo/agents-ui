/**
 * Turning a unified diff back into something you can point at.
 *
 * The patch arrives as one string. To say "this line, in this file" — which is
 * what reviewing is — each line has to know which file it belongs to and which
 * line number it would be after the change. Both are recoverable from the diff
 * itself: `+++ b/path` names the file, and `@@ -a,b +c,d @@` says where the
 * next run of lines lands.
 */

export type PatchLineKind = 'add' | 'remove' | 'context' | 'hunk' | 'meta'

export interface PatchLine {
  text: string
  kind: PatchLineKind
  /** The file this line belongs to, once one has been named. */
  file?: string
  /** Line number in the changed file. Absent for removals and headers. */
  line?: number
}

/** The separator the diff endpoint inserts between committed and working changes. */
const UNCOMMITTED_MARKER = '--- Uncommitted ---'

export function parsePatch(patch: string): PatchLine[] {
  if (!patch) return []

  const lines: PatchLine[] = []
  let file: string | undefined
  let next = 0

  for (const text of patch.split('\n')) {
    // Our own separator, which would otherwise read as a file header.
    if (text === UNCOMMITTED_MARKER) {
      lines.push({ text, kind: 'meta' })
      file = undefined
      continue
    }

    if (text.startsWith('+++ ')) {
      const named = text.slice(4).trim()
      // `/dev/null` is a deletion; there is no file to comment on.
      file = named === '/dev/null' ? undefined : named.replace(/^b\//, '')
      lines.push({ text, kind: 'meta', file })
      continue
    }

    if (text.startsWith('@@')) {
      const match = text.match(/@@ -\d+(?:,\d+)? \+(\d+)/)
      next = match ? Number(match[1]) : 0
      lines.push({ text, kind: 'hunk', file })
      continue
    }

    if (text.startsWith('diff --git') || text.startsWith('--- ') || text.startsWith('index ')
      || text.startsWith('new file') || text.startsWith('deleted file') || text.startsWith('similarity ')
      || text.startsWith('rename ')) {
      lines.push({ text, kind: 'meta', file })
      continue
    }

    if (text.startsWith('+')) {
      lines.push({ text, kind: 'add', file, line: next })
      next++
      continue
    }

    if (text.startsWith('-')) {
      // A removed line has no place in the new file, but it is still worth
      // pointing at — the line it sat before is the useful anchor.
      lines.push({ text, kind: 'remove', file, line: next })
      continue
    }

    lines.push({ text, kind: 'context', file, line: next })
    if (text || lines.length) next++
  }

  return lines
}

export interface ReviewComment {
  file: string
  line: number
  /** The line as it appears in the diff, so the note carries its own context. */
  snippet: string
  body: string
}

/**
 * Gather comments into one instruction.
 *
 * One turn rather than one per comment: each turn is a whole agent run, and
 * review notes are meant together — three remarks about the same change are a
 * single piece of feedback, and sending them separately invites three
 * uncoordinated rewrites.
 */
export function formatReview(comments: ReviewComment[]): string {
  if (!comments.length) return ''

  const byFile = new Map<string, ReviewComment[]>()
  for (const comment of comments) {
    const bucket = byFile.get(comment.file) ?? []
    bucket.push(comment)
    byFile.set(comment.file, bucket)
  }

  const sections = [...byFile.entries()].map(([file, group]) => {
    const notes = group
      .sort((a, b) => a.line - b.line)
      .map(comment => `Line ${comment.line}:\n\`\`\`\n${comment.snippet.trim()}\n\`\`\`\n${comment.body.trim()}`)
      .join('\n\n')

    return `**${file}**\n\n${notes}`
  })

  const count = comments.length
  return `I have ${count} comment${count === 1 ? '' : 's'} on what you just changed.\n\n`
    + `${sections.join('\n\n')}\n\n`
    + 'Address each one. If you disagree with any of them, say so instead of changing it.'
}
