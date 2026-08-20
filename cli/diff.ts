/**
 * A patch, as the files it is made of.
 *
 * The diff pane used to be one long scroll: a twelve-file change was read by
 * holding a key, and there was no way to ask "what happened to the server
 * util". A unified diff already says where each file starts — `diff --git` — so
 * turning that into jump points is arithmetic, not parsing, and it is the
 * difference between reading a diff and scrolling past one.
 */

export interface PatchFile {
  /** `server/utils/wall.ts`, taken from the `b/` side so a rename reads forwards. */
  path: string
  /** Index of the file's first line within the patch. */
  start: number
  added: number
  removed: number
}

const HEADER = /^diff --git a\/(.+?) b\/(.+)$/

export function patchFiles(patch: string): PatchFile[] {
  const lines = patch.split('\n')
  const files: PatchFile[] = []

  for (const [index, line] of lines.entries()) {
    const header = HEADER.exec(line)
    if (header) {
      files.push({ path: header[2] ?? header[1] ?? '?', start: index, added: 0, removed: 0 })
      continue
    }

    const current = files[files.length - 1]
    if (!current) continue
    // `+++`/`---` are the file markers rather than changed lines, and counting
    // them makes every file look one line bigger than it is.
    if (line.startsWith('+') && !line.startsWith('+++')) current.added += 1
    else if (line.startsWith('-') && !line.startsWith('---')) current.removed += 1
  }

  return files
}

/**
 * The file a given line belongs to.
 *
 * Used to say which file you are looking at while scrolling, which is the other
 * half of being able to jump: a hunk with no name above it is a hunk you have
 * to scroll back up to identify.
 */
export function fileAt(files: PatchFile[], line: number): PatchFile | null {
  let found: PatchFile | null = null
  for (const file of files) {
    if (file.start <= line) found = file
    else break
  }
  return found
}

/** The line to scroll to for the next or previous file, from wherever you are. */
export function stepFile(files: PatchFile[], line: number, direction: 1 | -1): number | null {
  if (files.length === 0) return null

  if (direction === 1) {
    const next = files.find(file => file.start > line)
    return next ? next.start : null
  }

  const current = fileAt(files, line)
  const at = current ? files.indexOf(current) : files.length
  // Jumping back from the middle of a file means the top of *this* file first,
  // which is what `[[` does in an editor and what somebody scrolling expects.
  if (current && current.start < line) return current.start
  return at > 0 ? files[at - 1]!.start : null
}

/** `4 files  +80/−12`, for a pane header. */
export function patchSummary(files: PatchFile[]): string {
  if (files.length === 0) return 'no changes'
  const added = files.reduce((total, file) => total + file.added, 0)
  const removed = files.reduce((total, file) => total + file.removed, 0)
  return `${files.length} file${files.length === 1 ? '' : 's'}  +${added}/−${removed}`
}
