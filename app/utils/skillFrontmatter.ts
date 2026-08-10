import type { SkillFrontmatter } from '~/types'

/**
 * Editing a skill without throwing away the parts this app has no field for.
 *
 * A skill's frontmatter is whatever its author wrote. This app shows four keys
 * and understands a fifth, and the Agent Skills format has more than that —
 * `license`, `metadata`, and whatever a future version adds. Rebuilding the
 * frontmatter from the form fields, which is the obvious thing to do, silently
 * deletes every key the form does not know about: you open somebody's skill to
 * fix a typo in its description, press Save, and its `allowed-tools` is gone.
 * The file is still valid, the skill quietly does something else, and nothing
 * in the app ever said so.
 *
 * So the original frontmatter is the base and the form is an overlay on top of
 * it. Unknown keys survive because nothing ever looks at them.
 */

/** The keys the editor owns. Everything else is carried through untouched. */
const EDITED_KEYS = ['name', 'description', 'context', 'agent', 'allowed-tools'] as const

/** Optional keys worth removing entirely when they come back empty. */
const OPTIONAL_KEYS = ['context', 'agent', 'allowed-tools'] as const

/**
 * `original` as read from disk, with the editor's fields applied over it.
 *
 * Key order follows `original` so saving a file this app did not write produces
 * a diff of the lines that changed, rather than a wholesale reshuffle that
 * makes a one-word edit unreviewable.
 */
export function mergeSkillFrontmatter(
  original: SkillFrontmatter | undefined,
  edited: SkillFrontmatter,
): SkillFrontmatter {
  const merged: SkillFrontmatter = { ...(original ?? {}) } as SkillFrontmatter

  // Indexed rather than assigned field by field, so adding a key to
  // `EDITED_KEYS` is the only change a new editable field needs. The cast is
  // because a union of literal keys narrows the value type to an intersection
  // of all of theirs, which nothing can satisfy.
  const writable = merged as Record<string, unknown>

  for (const key of EDITED_KEYS) {
    if (!(key in edited)) continue

    const value = edited[key]
    writable[key] = typeof value === 'string' ? value.trim() : value
  }

  for (const key of OPTIONAL_KEYS) {
    if (isEmpty(writable[key])) delete writable[key]
  }

  // `name` and `description` are what every other surface reads first, so they
  // lead the file even when the original had them further down.
  const { name, description, ...rest } = merged
  return { name: name ?? '', description: description ?? '', ...rest }
}

/**
 * The same frontmatter as `mergeSkillFrontmatter` would write it.
 *
 * Used for the baseline the unsaved-changes indicator compares against. Without
 * it, a file on disk carrying `agent: ""` reads as modified the instant it
 * opens — the editor would drop that empty key on save, so the comparison has
 * to be made against what saving would actually produce rather than against the
 * raw file.
 */
export function normalizeSkillFrontmatter(frontmatter: SkillFrontmatter): SkillFrontmatter {
  return mergeSkillFrontmatter(frontmatter, frontmatter)
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * A comma-or-newline separated tool list from a text field.
 *
 * People type these with whatever separator is to hand, and an empty entry from
 * a trailing comma would become a tool named "" in the allowlist.
 */
export function parseAllowedTools(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map(t => t.trim())
    .filter(Boolean)
}

/** The same list on its way back into that text field. */
export function formatAllowedTools(value: unknown): string {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean).join(', ')
  if (typeof value === 'string') return value
  return ''
}
