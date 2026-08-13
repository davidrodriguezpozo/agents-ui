/**
 * Grouping by where a thing came from.
 *
 * Agents, commands, skills and workflows are five variations on the same idea —
 * a named thing, from somewhere, with a description — and each page had grown
 * its own way of listing them: a card grid, a dense table, grouped rows, cards
 * again. A user learned the interaction four times, and on the skills page the
 * one skill they had written sat alphabetically among 198 from plugins.
 *
 * The grouping was already right in one place (`useCommands`). This is that
 * logic, lifted out so the other three can have it too.
 */

export type GroupKind = 'user' | 'project' | 'github' | 'plugin'

/** Anything that knows where it came from. */
export interface HasOrigin {
  scope?: 'user' | 'project'
  source?: 'local' | 'plugin' | 'github'
  pluginId?: string
  pluginName?: string
  githubRepo?: string
}

export interface OriginGroup<T> {
  key: string
  label: string
  icon: string
  kind: GroupKind
  /** Set for plugin groups, so the group header can link to the plugin. */
  pluginId?: string
  items: T[]
}

/** Yours first, then the project's, then imports, then plugins. */
const ORDER: Record<GroupKind, number> = { user: 0, project: 1, github: 2, plugin: 3 }

/**
 * A plugin group this big is not something you scan — it is something you
 * search. Collapsing it is what keeps a page with 199 skills legible, and what
 * keeps the one skill you wrote from being buried under someone else's 137.
 */
const COLLAPSE_ABOVE = 10

function describe(item: HasOrigin): Omit<OriginGroup<never>, 'items'> {
  if (item.source === 'plugin') {
    return {
      key: `plugin:${item.pluginId ?? 'unknown'}`,
      label: item.pluginName || 'Plugin',
      icon: 'i-lucide-puzzle',
      kind: 'plugin',
      pluginId: item.pluginId,
    }
  }
  if (item.source === 'github') {
    return { key: 'github', label: 'Imported from GitHub', icon: 'i-lucide-github', kind: 'github' }
  }
  if (item.scope === 'project') {
    return { key: 'project', label: 'This project', icon: 'i-lucide-folder-git-2', kind: 'project' }
  }
  return { key: 'user', label: 'Personal', icon: 'i-lucide-user', kind: 'user' }
}

export function groupByOrigin<T extends HasOrigin>(items: T[]): OriginGroup<T>[] {
  const groups = new Map<string, OriginGroup<T>>()

  for (const item of items) {
    const meta = describe(item)
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] })
    groups.get(meta.key)!.items.push(item)
  }

  return [...groups.values()].sort((a, b) =>
    ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label),
  )
}

/**
 * Which groups a page should open collapsed. Your own work is always open —
 * it is the reason you came to the page. A big pile from somebody else's
 * plugin is not.
 */
export function initiallyCollapsed<T>(groups: OriginGroup<T>[]): Record<string, boolean> {
  const state: Record<string, boolean> = {}
  for (const group of groups) {
    const isOthers = group.kind === 'plugin' || group.kind === 'github'
    state[group.key] = isOthers && group.items.length > COLLAPSE_ABOVE
  }
  return state
}

/**
 * Anything a search should look through, as a string it can be searched in.
 *
 * The fields these come from are YAML frontmatter, and the types that describe
 * them are a hope rather than a guarantee. `argument-hint: [--since YYYY-MM-DD]`
 * is valid authoring — Claude Code's own docs show the flow-sequence form — and
 * it arrives as an array against a type that says `string`. Calling
 * `.toLowerCase()` on it threw, and because the throw happened inside a
 * `computed`, the list silently stopped filtering rather than failing loudly.
 */
function asSearchable(field: unknown): string {
  if (typeof field === 'string') return field
  if (field == null) return ''
  if (Array.isArray(field)) return field.map(asSearchable).join(' ')
  if (typeof field === 'number' || typeof field === 'boolean') return String(field)
  return ''
}

/**
 * Filter groups by a search term, dropping any that end up empty.
 *
 * `text` returns the searchable fields for one item, so each page decides what
 * counts — a command's invocation, a skill's linked agent — without this needing
 * to know any of their shapes.
 */
export function filterGroups<T>(
  groups: OriginGroup<T>[],
  query: string,
  text: (item: T) => unknown[],
): OriginGroup<T>[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups

  return groups
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        text(item).some(field => asSearchable(field).toLowerCase().includes(q)),
      ),
    }))
    .filter(group => group.items.length > 0)
}
