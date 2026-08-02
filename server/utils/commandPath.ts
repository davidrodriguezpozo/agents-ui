/** `git--sync` → `commands/git/sync.md`. Inverse of the slug built in `collect.ts`. */
export function slugToPath(slug: string): { directory: string; filename: string } {
  const parts = slug.split('--')
  if (parts.length === 1) {
    return { directory: '', filename: `${parts[0]}.md` }
  }
  const filename = `${parts.pop()}.md`
  return { directory: parts.join('/'), filename }
}
