import { describe, it, expect } from 'vitest'
import { buildPalette, flattenPalette, isSubsequence, scoreItem, type PaletteItem, type PaletteSource } from '~/utils/palette'
import type { Capability } from '~/utils/capabilities'

const capability = (over: Partial<Capability> = {}): Capability => ({
  type: 'skill', key: 'skill:block-kit', slug: 'block-kit', to: '/skills/block-kit',
  name: 'block-kit', description: 'Build Block Kit layouts', mono: false,
  source: 'plugin', pluginName: 'slack',
  ...over,
})

function source(over: Partial<PaletteSource> = {}): PaletteSource {
  return {
    capabilities: [],
    plugins: [],
    sessions: [],
    projects: [],
    currentProject: '/work/here',
    isDark: true,
    isSimple: false,
    ...over,
  }
}

const labels = (items: PaletteItem[]) => items.map(i => i.label)
const kinds = (groups: ReturnType<typeof buildPalette>) => groups.map(g => g.kind)

describe('an empty query', () => {
  it('opens on something useful rather than an empty box', () => {
    const groups = buildPalette(source(), '')
    expect(groups.length).toBeGreaterThan(0)
    expect(kinds(groups)).toContain('action')
    expect(kinds(groups)).toContain('goto')
  })

  it('does not dump the whole library into it', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      capability({ key: `skill:${i}`, slug: `s${i}`, name: `skill-${i}` }))
    const groups = buildPalette(source({ capabilities: many }), '')
    const library = groups.find(g => g.kind === 'library')
    expect(library!.items.length).toBeLessThanOrEqual(3)
  })

  it('reaches Settings and Now, which it never could before', () => {
    const all = flattenPalette(buildPalette(source(), ''))
    expect(all.some(i => i.to === '/settings')).toBe(true)
    expect(all.some(i => i.to === '/')).toBe(true)
  })

  it('leaves project switches out until you type, so Go to stays on screen', () => {
    const projects = Array.from({ length: 5 }, (_, i) => ({ path: `/p${i}`, name: `p${i}` }))

    const idle = flattenPalette(buildPalette(source({ projects }), ''))
    expect(idle.filter(i => i.run?.type === 'switch-project')).toEqual([])
    expect(idle.some(i => i.to === '/settings')).toBe(true)

    const typed = flattenPalette(buildPalette(source({ projects }), 'p3'))
    expect(typed.filter(i => i.run?.type === 'switch-project')).toHaveLength(1)
  })
})

describe('ranking', () => {
  const item = (label: string, over: Partial<PaletteItem> = {}): PaletteItem => ({
    key: label, kind: 'library', label, icon: 'x', ...over,
  })

  it('prefers a prefix, then a word start, then a substring', () => {
    expect(scoreItem(item('slack-api'), 'sla')).toBe(0)
    expect(scoreItem(item('use slack now'), 'sla')).toBe(1)
    expect(scoreItem(item('unslackable'), 'sla')).toBe(2)
  })

  it('splits words on slashes and colons, so a command is findable by its verb', () => {
    expect(scoreItem(item('/defender:pickup'), 'pickup')).toBe(1)
    expect(scoreItem(item('/hd:release-notes'), 'release')).toBe(1)
  })

  it('ranks a hidden keyword match below anything visible', () => {
    const visible = scoreItem(item('agent-thing'), 'agent')
    const hidden = scoreItem(item('something', { keywords: 'agent' }), 'agent')
    expect(visible).toBeLessThan(hidden!)
  })

  it('returns null when nothing matches', () => {
    expect(scoreItem(item('nothing like it'), 'zzz')).toBeNull()
  })

  it('puts actions before library rows for the same quality of match', () => {
    const groups = buildPalette(source({
      capabilities: [capability({ name: 'session-helper' })],
    }), 'session')
    expect(kinds(groups)[0]).toBe('action')
  })
})

describe('actions', () => {
  it('offers every project except the one already selected', () => {
    const groups = buildPalette(source({
      projects: [
        { path: '/work/here', name: 'here', branch: 'main' },
        { path: '/work/there', name: 'there', branch: 'dev' },
      ],
    }), 'switch')
    // "switch" also matches the theme and mode actions, which is correct — so
    // this asks about project switching specifically.
    const switches = flattenPalette(groups).filter(i => i.run?.type === 'switch-project')
    expect(labels(switches)).toEqual(['Switch to there'])
    expect(switches[0]!.run).toEqual({ type: 'switch-project', path: '/work/there' })
    expect(switches[0]!.hint).toBe('dev')
  })

  it('names the theme it will switch to, not the one you are in', () => {
    const dark = flattenPalette(buildPalette(source({ isDark: true }), 'mode'))
    expect(labels(dark)).toContain('Switch to light mode')

    const light = flattenPalette(buildPalette(source({ isDark: false }), 'mode'))
    expect(labels(light)).toContain('Switch to dark mode')
  })

  it('creates each kind of thing', () => {
    const items = flattenPalette(buildPalette(source(), 'new'))
    expect(labels(items)).toEqual(
      expect.arrayContaining(['New ritual', 'New agent', 'New command', 'New skill']),
    )
  })
})

describe('simple mode', () => {
  it('does not offer destinations the sidebar is deliberately hiding', () => {
    const advanced = flattenPalette(buildPalette(source({ isSimple: false }), 'graph'))
    expect(labels(advanced)).toContain('Graph')

    const simple = flattenPalette(buildPalette(source({ isSimple: true }), 'graph'))
    expect(labels(simple)).not.toContain('Graph')
  })

  it('still reaches everything simple mode does show', () => {
    const items = flattenPalette(buildPalette(source({ isSimple: true }), ''))
    // /sessions and /runs became one destination when Work merged them.
    for (const path of ['/', '/work', '/land', '/schedules', '/library', '/settings']) {
      expect(items.some(i => i.to === path), `should reach ${path}`).toBe(true)
    }
  })

  it('finds Work by either of the words it used to be called', () => {
    for (const term of ['sessions', 'activity', 'runs']) {
      const items = flattenPalette(buildPalette(source(), term))
      expect(items.some(i => i.to === '/work'), `"${term}" should find Work`).toBe(true)
    }
  })
})

describe('sessions and library', () => {
  it('finds an open session by title and goes straight to it', () => {
    const groups = buildPalette(source({
      sessions: [{ id: 'abc', title: 'Add faceted search', branch: 'add-faceted-search', activity: 'working' }],
    }), 'faceted')
    const [item] = flattenPalette(groups)
    expect(item!.to).toBe('/sessions/abc')
    expect(item!.hint).toBe('add-faceted-search')
  })

  it('finds a capability through the plugin that brought it', () => {
    const groups = buildPalette(source({ capabilities: [capability()] }), 'slack')
    expect(labels(flattenPalette(groups))).toContain('block-kit')
  })

  it('caps each section so one plugin cannot crowd out the rest', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      capability({ key: `skill:${i}`, slug: `s${i}`, name: `posthog-thing-${i}` }))
    const groups = buildPalette(source({ capabilities: many }), 'posthog')
    expect(groups.find(g => g.kind === 'library')!.items.length).toBeLessThanOrEqual(6)
  })

  it('gives every row a unique key, so arrow keys cannot land on two at once', () => {
    const groups = buildPalette(source({
      capabilities: [capability(), capability({ key: 'command:x', type: 'command', slug: 'x', name: 'block-kit' })],
      plugins: [{ id: 'slack', name: 'slack' }],
      sessions: [{ id: 's1', title: 'slack thing', branch: 'b', activity: 'idle' }],
      projects: [{ path: '/p', name: 'slack-proj' }],
    }), 'slack')
    const keys = flattenPalette(groups).map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('no matches', () => {
  it('returns nothing rather than an empty section', () => {
    expect(buildPalette(source(), 'zzzzzz')).toEqual([])
  })
})

describe('fuzzy matching', () => {
  const item = (label: string, over: Partial<PaletteItem> = {}): PaletteItem => ({
    key: label, kind: 'library', label, icon: 'x', ...over,
  })

  it('finds a word by its consonants, the way people actually type', () => {
    expect(isSubsequence('wkfl', 'workflows')).toBe(true)
    expect(isSubsequence('dfpu', '/defender:pickup')).toBe(true)
    expect(isSubsequence('wlkf', 'workflows')).toBe(false)
  })

  it('ranks a scattered match below every literal one', () => {
    const literal = scoreItem(item('workflows'), 'work')!
    const scattered = scoreItem(item('workflows'), 'wkfl')!
    expect(scattered).toBeGreaterThan(literal)
    expect(scattered).toBeGreaterThan(scoreItem(item('x', { keywords: 'wkfl' }), 'wkfl')!)
  })

  it('will not match on a single letter, which every row contains', () => {
    expect(scoreItem(item('workflows'), 'q')).toBeNull()
    expect(scoreItem(item('nothing like it'), 'zzz')).toBeNull()
  })

  it('reaches a destination nothing else would have found', () => {
    const items = flattenPalette(buildPalette(source(), 'wkfl'))
    expect(items.some(i => i.to === '/workflows')).toBe(true)
  })
})

describe('recent picks', () => {
  it('opens on what you last chose, before anything else', () => {
    const groups = buildPalette(source({ recent: ['go:settings', 'go:land'] }), '')
    expect(groups[0]!.kind).toBe('recent')
    expect(groups[0]!.items.map(i => i.to)).toEqual(['/settings', '/land'])
  })

  it('does not also leave them where they were', () => {
    const groups = buildPalette(source({ recent: ['go:settings'] }), '')
    const goto = groups.find(g => g.kind === 'goto')!
    expect(goto.items.some(i => i.to === '/settings')).toBe(false)
  })

  it('re-keys them, so the arrow keys cannot land on two rows at once', () => {
    const keys = flattenPalette(buildPalette(source({ recent: ['go:settings'] }), '')).map(i => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('drops a key that no longer resolves rather than showing a dead row', () => {
    const groups = buildPalette(source({ recent: ['session:gone-for-good'] }), '')
    expect(groups.some(g => g.kind === 'recent')).toBe(false)
  })

  it('gets out of the way once you type, but breaks ties in its favour', () => {
    const groups = buildPalette(source({
      capabilities: [
        capability({ key: 'skill:alpha', slug: 'alpha', name: 'deploy-alpha' }),
        capability({ key: 'skill:beta', slug: 'beta', name: 'deploy-beta' }),
      ],
      recent: ['lib:skill:beta'],
    }), 'deploy')

    expect(groups.some(g => g.kind === 'recent')).toBe(false)
    const library = groups.find(g => g.kind === 'library')!
    expect(library.items.map(i => i.label)).toEqual(['deploy-beta', 'deploy-alpha'])
  })

  it('shows at most a handful', () => {
    const recent = ['go:settings', 'go:land', 'go:work', 'go:library', 'go:wall', 'go:explore', 'go:now']
    const groups = buildPalette(source({ recent }), '')
    expect(groups[0]!.items.length).toBeLessThanOrEqual(5)
  })
})

describe('chord hints', () => {
  it('tells a destination row how to get there without the panel', () => {
    const items = flattenPalette(buildPalette(source(), 'work'))
    expect(items.find(i => i.to === '/work')!.shortcut).toBe('g w')
  })

  it('says nothing about a row with no chord', () => {
    const groups = buildPalette(source({
      sessions: [{ id: 'a', title: 'thing', branch: 'b', activity: 'idle' }],
    }), 'thing')
    expect(flattenPalette(groups)[0]!.shortcut).toBeUndefined()
  })
})
