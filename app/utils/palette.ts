import type { Capability } from '~/utils/capabilities'
import { CAPABILITY_LOOK } from '~/utils/capabilities'

/**
 * The command palette's contents.
 *
 * ⌘K could only navigate, and only to four of the app's own object types — you
 * could not reach Settings, or Now, or a session, and you could not *do*
 * anything. On a tool whose whole audience lives at a keyboard that is the
 * difference between a search box and a command palette.
 *
 * Ranking, grouping and matching are here rather than in the component so the
 * behaviour can be tested without mounting anything.
 */

export type PaletteKind = 'action' | 'goto' | 'session' | 'library'

/** Something the palette does rather than somewhere it goes. */
export type PaletteAction =
  | { type: 'switch-project'; path: string }
  | { type: 'toggle-theme' }
  | { type: 'toggle-mode' }

export interface PaletteItem {
  key: string
  kind: PaletteKind
  label: string
  /** The quiet half of the row: a description, a branch, a path. */
  hint?: string
  icon: string
  /** Tinted when the row carries its own identity colour, as agents do. */
  colour?: string
  to?: string
  run?: PaletteAction
  /** Extra words this should match on but not display. */
  keywords?: string
}

export const KIND_LABELS: Record<PaletteKind, string> = {
  action: 'Actions',
  goto: 'Go to',
  session: 'Sessions',
  library: 'Library',
}

/** The order sections appear in, and the tie-break between equal matches. */
const KIND_ORDER: PaletteKind[] = ['action', 'goto', 'session', 'library']

export interface PaletteSource {
  /** Every capability, already mapped — the Library page builds the same list. */
  capabilities: Capability[]
  plugins: { id: string; name: string; description?: string }[]
  sessions: { id: string; title: string; branch: string; activity: string }[]
  projects: { path: string; name: string; branch?: string | null }[]
  /** The one currently selected, which is not worth offering to switch to. */
  currentProject?: string | null
  isDark: boolean
  isSimple: boolean
}

function navigation(isSimple: boolean): PaletteItem[] {
  const items: PaletteItem[] = [
    { key: 'go:now', kind: 'goto', label: 'Now', icon: 'i-lucide-target', to: '/', keywords: 'home dashboard needs you' },
    { key: 'go:work', kind: 'goto', label: 'Work', icon: 'i-lucide-git-branch', to: '/work', keywords: 'sessions activity runs branches worktrees history log' },
    { key: 'go:reviews', kind: 'goto', label: 'Reviews', icon: 'i-lucide-git-pull-request', to: '/pulls', keywords: 'pull requests pr' },
    { key: 'go:daily', kind: 'goto', label: 'Daily', icon: 'i-lucide-alarm-clock', to: '/schedules', keywords: 'rituals schedule cron' },
    { key: 'go:library', kind: 'goto', label: 'Library', icon: 'i-lucide-library', to: '/library', keywords: 'agents commands skills' },
    { key: 'go:settings', kind: 'goto', label: 'Settings', icon: 'i-lucide-settings', to: '/settings', keywords: 'preferences limits sandbox backups' },
  ]

  // Authoring surfaces are advanced-only, and offering a destination the
  // sidebar is deliberately hiding would be the palette overruling that.
  if (!isSimple) {
    items.push(
      { key: 'go:workflows', kind: 'goto', label: 'Workflows', icon: 'i-lucide-git-branch', to: '/workflows', keywords: 'pipeline chain' },
      { key: 'go:plugins', kind: 'goto', label: 'Plugins', icon: 'i-lucide-puzzle', to: '/plugins', keywords: 'marketplace extensions' },
      { key: 'go:mcp', kind: 'goto', label: 'MCP', icon: 'i-lucide-plug', to: '/mcp', keywords: 'servers tools external' },
      { key: 'go:graph', kind: 'goto', label: 'Graph', icon: 'i-lucide-workflow', to: '/graph', keywords: 'relationships connections' },
    )
  }

  items.push({ key: 'go:explore', kind: 'goto', label: 'Explore', icon: 'i-lucide-compass', to: '/explore', keywords: 'add tools templates install' })
  return items
}

function actions(source: PaletteSource): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      key: 'act:session',
      kind: 'action',
      label: 'Start a session',
      hint: 'Give Claude its own copy of this project',
      icon: 'i-lucide-plus',
      to: '/work',
      keywords: 'new work branch',
    },
    {
      key: 'act:ritual',
      kind: 'action',
      label: 'New ritual',
      hint: 'Work that fires on a schedule',
      icon: 'i-lucide-alarm-clock-plus',
      to: '/schedules?new=1',
      keywords: 'schedule cron daily',
    },
  ]

  for (const type of ['agent', 'command', 'skill'] as const) {
    items.push({
      key: `act:new-${type}`,
      kind: 'action',
      label: `New ${type}`,
      icon: CAPABILITY_LOOK[type].icon,
      to: `/library?new=${type}`,
      keywords: 'create add',
    })
  }

  items.push(
    {
      key: 'act:theme',
      kind: 'action',
      label: source.isDark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: source.isDark ? 'i-lucide-sun' : 'i-lucide-moon',
      run: { type: 'toggle-theme' },
      keywords: 'theme appearance dark light',
    },
    {
      key: 'act:mode',
      kind: 'action',
      label: source.isSimple ? 'Show advanced tools' : 'Switch to simple view',
      icon: source.isSimple ? 'i-lucide-settings-2' : 'i-lucide-minimize-2',
      run: { type: 'toggle-mode' },
      keywords: 'simple advanced mode',
    },
  )

  // Switching project is the most frequent thing here that was not reachable
  // from a keyboard at all — it lived in a popover at the bottom of the sidebar.
  for (const project of source.projects) {
    if (project.path === source.currentProject) continue
    items.push({
      key: `act:project:${project.path}`,
      kind: 'action',
      label: `Switch to ${project.name}`,
      hint: project.branch ?? undefined,
      icon: 'i-lucide-folder-git-2',
      run: { type: 'switch-project', path: project.path },
      keywords: `project repository ${project.path}`,
    })
  }

  return items
}

function fromSessions(source: PaletteSource): PaletteItem[] {
  return source.sessions.map(session => ({
    key: `session:${session.id}`,
    kind: 'session' as const,
    label: session.title,
    hint: session.branch,
    icon: session.activity === 'working' ? 'i-lucide-loader-2' : 'i-lucide-git-branch',
    to: `/sessions/${session.id}`,
  }))
}

function fromLibrary(source: PaletteSource): PaletteItem[] {
  const items: PaletteItem[] = source.capabilities.map(item => ({
    key: `lib:${item.key}`,
    kind: 'library' as const,
    label: item.name,
    hint: item.description,
    icon: CAPABILITY_LOOK[item.type].icon,
    colour: item.type === 'agent' ? item.colour : undefined,
    to: item.to,
    keywords: [item.pluginName, CAPABILITY_LOOK[item.type].label].filter(Boolean).join(' '),
  }))

  for (const plugin of source.plugins) {
    items.push({
      key: `lib:plugin:${plugin.id}`,
      kind: 'library',
      label: plugin.name,
      hint: plugin.description,
      icon: 'i-lucide-puzzle',
      to: `/plugins/${encodeURIComponent(plugin.id)}`,
      keywords: 'plugin',
    })
  }

  return items
}

/**
 * How well an item answers the query. Lower is better; `null` is no match.
 *
 * A prefix beats a word-start beats a substring, and anything matched only on
 * hidden keywords ranks below everything matched on what is actually on screen —
 * otherwise typing "agent" puts the word "Agent" in a dozen hidden keyword
 * fields above the agent you were looking for.
 */
export function scoreItem(item: PaletteItem, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const label = item.label.toLowerCase()
  if (label.startsWith(q)) return 0
  if (label.split(/[\s/:\-_]+/).some(word => word.startsWith(q))) return 1
  if (label.includes(q)) return 2

  const hint = (item.hint ?? '').toLowerCase()
  if (hint.includes(q)) return 3

  const keywords = (item.keywords ?? '').toLowerCase()
  if (keywords.includes(q)) return 4

  return null
}

export interface PaletteGroup {
  kind: PaletteKind
  label: string
  items: PaletteItem[]
}

/**
 * How many rows a section may show.
 *
 * The cap exists so one plugin's 137 skills cannot crowd out everything else.
 * It must not apply to the fixed lists: capping "Go to" at six meant Settings —
 * the eleventh destination — was unreachable from the palette on an empty query,
 * which is the exact failure this whole change was meant to fix.
 */
const PER_KIND: Record<PaletteKind, number> = {
  action: 12,
  goto: Infinity,
  session: 6,
  library: 6,
}

/**
 * Grouped, ranked results.
 *
 * An empty query is not an empty palette: it opens on the things you would most
 * plausibly want, which is what makes it worth pressing before you know what
 * you are looking for.
 */
export function buildPalette(source: PaletteSource, query: string): PaletteGroup[] {
  const all = [
    ...actions(source),
    ...navigation(source.isSimple),
    ...fromSessions(source),
    ...fromLibrary(source),
  ]

  const q = query.trim()

  const scored = all
    .map(item => ({ item, score: scoreItem(item, q) }))
    .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)

  return KIND_ORDER
    .map((kind) => {
      let items = scored.filter(entry => entry.item.kind === kind)

      if (!q) {
        // With nothing typed, the Library is 247 rows of nothing in particular;
        // the sections that are a short list of verbs and places are the useful ones.
        if (kind === 'library' || kind === 'session') items = items.slice(0, 3)

        // And one project per row pushed "Go to" off the bottom of the panel on a
        // machine with five of them. Switching is a thing you type a name for.
        if (kind === 'action') items = items.filter(e => e.item.run?.type !== 'switch-project')
      }

      return {
        kind,
        label: KIND_LABELS[kind],
        items: items
          .sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label))
          .slice(0, PER_KIND[kind])
          .map(entry => entry.item),
      }
    })
    .filter(group => group.items.length > 0)
}

/** The groups flattened, which is what arrow keys actually move through. */
export function flattenPalette(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap(group => group.items)
}
