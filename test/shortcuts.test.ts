import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_SHORTCUTS, EDITOR_SHORTCUTS, JUMP_SHORTCUTS, LIST_SHORTCUTS, PALETTE_SHORTCUTS,
  NAV_SHORTCUTS, chordHint, chordTarget, isBareKey, isRailToggle, isTerminalTarget, isTypingTarget, navShortcuts,
} from '~/utils/shortcuts'

describe('the chord table', () => {
  it('gives every destination its own key', () => {
    const keys = NAV_SHORTCUTS.map(item => item.key)
    expect(new Set(keys).size, `duplicate chord: ${keys}`).toBe(keys.length)
  })

  it('does not claim `g`, which is the chord itself', () => {
    expect(NAV_SHORTCUTS.some(item => item.key === 'g')).toBe(false)
  })

  it('binds each single key once', () => {
    // A chord's second key is only read while `g` is armed, so `n` meaning Now
    // after `g` and "start a session" on its own is not a clash. Two rows both
    // claiming a bare `n` would be.
    const singles = ACTION_SHORTCUTS.map(item => item.keys)
    expect(new Set(singles).size, `duplicate key: ${singles}`).toBe(singles.length)
  })

  it('routes a letter to a page', () => {
    expect(chordTarget('w', false)?.to).toBe('/work')
    expect(chordTarget('W', false)?.to).toBe('/work')
    expect(chordTarget('zzz', false)).toBeNull()
  })

  it('reaches everything in the sidebar', () => {
    for (const to of ['/', '/work', '/land', '/schedules', '/library', '/settings', '/wall', '/explore']) {
      expect(NAV_SHORTCUTS.some(item => item.to === to), `no chord reaches ${to}`).toBe(true)
    }
  })
})

describe('simple mode', () => {
  it('does not offer chords to pages the sidebar is hiding', () => {
    expect(chordTarget('r', false)?.to).toBe('/graph')
    expect(chordTarget('r', true)).toBeNull()
    expect(chordTarget('f', true)).toBeNull()
  })

  it('still reaches everything simple mode shows', () => {
    const simple = navShortcuts(true).map(item => item.to)
    for (const to of ['/', '/work', '/land', '/schedules', '/library', '/settings']) {
      expect(simple, `simple mode should keep ${to}`).toContain(to)
    }
  })
})

describe('hints', () => {
  it('prints the two presses as two presses', () => {
    expect(chordHint('/work')).toBe('g w')
  })

  it('says nothing for a page with no chord', () => {
    expect(chordHint('/sessions/abc')).toBeNull()
  })

  it('withholds the hint for a destination this mode hides', () => {
    expect(chordHint('/graph', false)).toBe('g r')
    expect(chordHint('/graph', true)).toBeNull()
  })
})

describe('when a key means a letter', () => {
  const el = (tag: string, props: Record<string, unknown> = {}) => ({
    tagName: tag.toUpperCase(),
    isContentEditable: false,
    getAttribute: () => null,
    ...props,
  }) as unknown as EventTarget

  it('keeps out of every box you can type in', () => {
    expect(isTypingTarget(el('input'))).toBe(true)
    expect(isTypingTarget(el('textarea'))).toBe(true)
    expect(isTypingTarget(el('select'))).toBe(true)
    // xterm's keyboard input and the code editor are both textareas, which is
    // the whole reason this check is on the tag and not on a class list.
  })

  it('keeps out of anything contenteditable, attribute or not', () => {
    expect(isTypingTarget(el('div', { isContentEditable: true }))).toBe(true)
  })

  it('leaves a combobox its arrow keys', () => {
    expect(isTypingTarget(el('div', { getAttribute: (n: string) => n === 'role' ? 'combobox' : null }))).toBe(true)
  })

  it('fires on the page itself', () => {
    expect(isTypingTarget(el('div'))).toBe(false)
    expect(isTypingTarget(el('a'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('modifiers', () => {
  const press = (over: Partial<KeyboardEvent> = {}) =>
    ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over }) as KeyboardEvent

  it('leaves ⌘, ctrl and alt combinations to whoever owns them', () => {
    expect(isBareKey(press())).toBe(true)
    expect(isBareKey(press({ metaKey: true }))).toBe(false)
    expect(isBareKey(press({ ctrlKey: true }))).toBe(false)
    expect(isBareKey(press({ altKey: true }))).toBe(false)
  })

  it('does not count shift, because `?` is one', () => {
    expect(isBareKey(press({ shiftKey: true }))).toBe(true)
  })

  /*
   * The rail's key is the exception, and it has to be: `\` is a bare key on a US
   * keyboard and an Option key on every ISO one, so the guard above hid the only
   * control that brings a collapsed rail back from everybody not typing on an
   * American layout.
   */
  it('lets the rail toggle through with ⌥ held, because ISO layouts type it that way', () => {
    expect(isRailToggle(press({ key: '\\' }))).toBe(true)
    expect(isRailToggle(press({ key: '\\', altKey: true }))).toBe(true)
    expect(isRailToggle(press({ key: '\\', altKey: true, shiftKey: true }))).toBe(true)
  })

  it('still leaves ⌘\\ and ⌃\\ to the browser and the shell', () => {
    expect(isRailToggle(press({ key: '\\', metaKey: true }))).toBe(false)
    expect(isRailToggle(press({ key: '\\', ctrlKey: true }))).toBe(false)
  })

  it('is the backslash and nothing else', () => {
    expect(isRailToggle(press({ key: '|', altKey: true }))).toBe(false)
    expect(isRailToggle(press({ key: 'ç' }))).toBe(false)
  })
})

describe('the terminal keeps its keys', () => {
  const inTerminal = (matches: boolean) => ({
    tagName: 'TEXTAREA',
    isContentEditable: false,
    getAttribute: () => null,
    closest: (selector: string) => (matches && selector === '.xterm' ? {} : null),
  }) as unknown as EventTarget

  it('recognises the shell, so nvim in the dock gets Escape and ⌃d', () => {
    expect(isTerminalTarget(inTerminal(true))).toBe(true)
  })

  it('does not claim every textarea on the page', () => {
    expect(isTerminalTarget(inTerminal(false))).toBe(false)
    expect(isTerminalTarget(null)).toBe(false)
  })
})

describe('the cheatsheet', () => {
  const every = [
    ...ACTION_SHORTCUTS, ...LIST_SHORTCUTS, ...JUMP_SHORTCUTS,
    ...PALETTE_SHORTCUTS, ...EDITOR_SHORTCUTS,
  ]

  it('labels every row it prints', () => {
    for (const row of every) {
      expect(row.keys.length).toBeGreaterThan(0)
      expect(row.label.length).toBeGreaterThan(0)
    }
  })

  it('documents the motions a vim user will reach for first', () => {
    const keys = every.map(row => row.keys)
    for (const motion of ['gg', 'G', '⌃d', '⌃u', 'zz', '⌃o', '⌃i']) {
      expect(keys, `${motion} should be in the cheatsheet`).toContain(motion)
    }
  })

  it('spells Ctrl the way vim does, not the way macOS does', () => {
    // ⌘ is this app's own layer; ⌃ is the one borrowed from the editor. Mixing
    // the glyphs is how somebody ends up pressing ⌘d and bookmarking the page.
    const borrowed = [...LIST_SHORTCUTS, ...JUMP_SHORTCUTS, ...PALETTE_SHORTCUTS]
    expect(borrowed.filter(row => row.keys.includes('⌘'))).toEqual([])
  })
})

/*
 * ── Whether the list keys actually reach anything ──────────────────────────────
 *
 * The tests above check the tables. These check the pages, which is where the
 * keyboard layer was broken on arrival: `j`/`k` resolve rows through
 * `main [data-row]`, no page sets that attribute itself, and it was carried by
 * exactly four components — so Land, Fleet, Daily, Plugins, MCP and Explore
 * rendered lists the keyboard could not see. Every one of them shipped a working
 * `g l` to a page where `j` did nothing, which is worse than no keyboard support
 * because the half that works implies the other half does.
 *
 * Source text rather than a mounted DOM on purpose: the failure being guarded
 * against is a new list page that never opts in, and a test that has to render
 * the page to notice is a test that needs the page to exist in a fixture first.
 */

const appDir = fileURLToPath(new URL('../app', import.meta.url))

function vueFilesIn(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...vueFilesIn(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

/**
 * Markup with the prose taken out.
 *
 * These files are heavily commented, and a comment that says `<main>` while
 * explaining which element scrolls is not a second `<main>` — `settings.vue`
 * has exactly that, and the first version of the test below failed on it.
 */
function withoutComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\*).*$/gm, '')
}

const vue = vueFilesIn(appDir).map(path => ({
  path: relative(appDir, path).split(sep).join('/'),
  text: readFileSync(path, 'utf8'),
}))

/** `data-row`, not `data-row-open`, which is a different attribute. */
const ROW_ATTR = /(?:^|\s)data-row(?=\s|$|=)/
const OPEN_ATTR = /(?:^|\s)data-row-open(?=\s|$|=)/

/**
 * Every element opening tag, as `{ tag, attrs }`.
 *
 * The quoted-string alternation is what makes this safe on a Vue template: a
 * `>` inside `:style="{ ... }"` or `@click="a > b"` must not end the tag.
 */
function openingTags(text: string): { tag: string; attrs: string }[] {
  const out: { tag: string; attrs: string }[] = []
  const re = /<([A-Za-z][\w.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)\/?>/g
  for (const match of text.matchAll(re)) out.push({ tag: match[1]!, attrs: match[2]! })
  return out
}

/** The rows declared in a file, with the tag they were declared on. */
function rowsIn(file: { path: string; text: string }) {
  return openingTags(file.text)
    .filter(el => ROW_ATTR.test(el.attrs))
    .map(el => ({ ...el, file: file.path }))
}

const allRows = vue.flatMap(rowsIn)

/**
 * Tags that are their own link or button, so the browser presses them on Enter.
 *
 * `component` is `NowQueue`'s row, which is `:is="item.href ? 'a' : 'NuxtLink'"`
 * — an anchor either way.
 */
const SELF_OPENING = new Set(['a', 'button', 'NuxtLink', 'component'])

describe('the rows the list keys walk', () => {
  it('finds some at all, so a broken scan fails loudly rather than passing empty', () => {
    expect(allRows.length).toBeGreaterThan(10)
  })

  it('can be focused, because `j` moves the cursor by focusing the next one', () => {
    // A `data-row` on a plain div with no tabindex is invisible to `land()`:
    // `focus()` on a non-focusable element does nothing, so `j` appears to be
    // dead when in fact it moved and nothing took the focus.
    const unfocusable = allRows
      .filter(row => !SELF_OPENING.has(row.tag) && !/(?:^|\s)tabindex(?=\s|=)/.test(row.attrs))
      .map(row => `${row.file}  <${row.tag}>`)

    expect(unfocusable).toEqual([])
  })

  it('shows a focus ring, so you can see which row Enter would open', () => {
    const invisible = allRows
      .filter(row => !/focus-ring/.test(row.attrs))
      .map(row => `${row.file}  <${row.tag}>`)

    expect(invisible).toEqual([])
  })

  /**
   * Rows with nothing to open, and why. Not an oversight list — Enter is
   * documented as "open it", and the only action on each of these is a write:
   * adopting a suggested ritual, installing a plugin, updating or removing a
   * marketplace. A keyboard layer that installs something because you pressed
   * Enter while reading is worse than one where Enter is quiet.
   */
  const NOTHING_TO_OPEN = new Set(['components/MarketplaceSourceRow.vue'])

  it('declares what Enter opens, or is a link that opens itself', () => {
    const orphaned = vue
      .filter(file => rowsIn(file).some(row => !SELF_OPENING.has(row.tag)))
      .filter(file => !OPEN_ATTR.test(file.text))
      .filter(file => !NOTHING_TO_OPEN.has(file.path))
      .map(file => file.path)

    expect(orphaned).toEqual([])
  })

  it('has no `data-row-open` stranded in a file with no row', () => {
    // The marker is only read through a focused `[data-row]`. One left behind in
    // a file whose row was removed or renamed is dead code that reads as working.
    const stranded = vue
      .filter(file => OPEN_ATTR.test(file.text) && !rowsIn(file).length)
      .map(file => file.path)

    expect(stranded).toEqual([])
  })
})

/**
 * The pages that show a list, and must therefore be walkable.
 *
 * Settings and Graph are deliberately absent: one is a form and the other a
 * canvas, and on both `⌃d`/`⌃u` fall through to scrolling the page, which is
 * what `halfPage` does when it finds no rows. Detail pages are absent for the
 * same reason.
 *
 * `pages/mcp.vue` was on this list until the servers became a facet of the
 * Library. It is a redirect now, with no rows of its own and nothing for a
 * keyboard to walk — the list it used to show is walked on `pages/library.vue`,
 * which is here.
 */
const LIST_PAGES = [
  'pages/index.vue',
  'pages/work.vue',
  'pages/land.vue',
  'pages/library.vue',
  'pages/schedules.vue',
  'pages/plugins/index.vue',
  'pages/shipped.vue',
  'pages/explore.vue',
  'pages/wall.vue',
  'pages/workflows/index.vue',
]

describe('every list page', () => {
  /** Component tag name → whether that component declares a row. */
  const carriers = new Set(
    vue.filter(file => rowsIn(file).length).map(file => file.path.replace(/^.*\//, '').replace(/\.vue$/, '')),
  )

  it('is a real file, so a rename turns into a failure and not a silent gap', () => {
    const missing = LIST_PAGES.filter(path => !vue.some(file => file.path === path))
    expect(missing).toEqual([])
  })

  it('renders rows the keyboard can find', () => {
    const deaf = LIST_PAGES.filter((path) => {
      const file = vue.find(f => f.path === path)!
      if (rowsIn(file).length) return false
      return ![...carriers].some(name => new RegExp(`<${name}[\\s/>]`).test(file.text))
    })

    expect(deaf).toEqual([])
  })

  it('keeps the shell as the only `main`, because that is what the row scan queries', () => {
    // `visibleRows()` reads `main [data-row]` and `scroller()` takes the first
    // `main` in the document. Fleet used to nest a second one inside the shell's,
    // which made both of those mean two different elements on one page.
    const nested = vue
      .filter(file => file.path !== 'app.vue' && /<main[\s>]/.test(withoutComments(file.text)))
      .map(file => file.path)

    expect(nested).toEqual([])
  })
})

/*
 * ── Two lists on one screen ───────────────────────────────────────────────────
 *
 * The work surface puts a rail of rows beside a page of rows, both inside the
 * shell's one `main` — so `visibleRows()` finds both and has to pick. It picks on
 * `data-rail`, and these guard the three source facts that makes that work.
 * Source text rather than a mounted DOM, like everything else in this file: the
 * suite runs without one, and the failure being guarded against is a component
 * dropping an attribute, which is visible here.
 */
describe('the rail and the page are walked separately', () => {
  const rail = vue.find(file => file.path === 'components/WorkRail.vue')!
  const railRow = vue.find(file => file.path === 'components/WorkRailRow.vue')!
  const listener = readFileSync(join(appDir, 'composables/useShortcuts.ts'), 'utf8')

  it('has a rail that says it is one', () => {
    // Without this attribute the partition collapses and `j` on the History list
    // starts at the top of the rail, walking every session before reaching the
    // first row anybody was looking at.
    expect(/(?:^|\s)data-rail(?=\s|$|=)/.test(withoutComments(rail.text))).toBe(true)
  })

  it('has exactly one, because the partition is a boolean', () => {
    const declaring = vue
      .filter(file => openingTags(withoutComments(file.text))
        .some(el => /(?:^|\s)data-rail(?=\s|$|=)/.test(el.attrs)))
      .map(file => file.path)

    expect(declaring).toEqual(['components/WorkRail.vue'])
  })

  it('decides which list to walk from where the focus is', () => {
    expect(listener).toContain('[data-rail]')
  })

  it('gives the hop keys their own rows to hop through', () => {
    // `⇧J`/`⇧K` navigate on every press, so they read a narrower set than
    // `j`/`k` — only the rail, never the page's rows.
    expect(/(?:^|\s)data-rail-row(?=\s|$|=)/.test(railRow.text)).toBe(true)
    expect(listener).toContain('main [data-rail-row]')
  })

  it('still lets the rail be walked, so the rows are ordinary rows too', () => {
    // `data-rail-row` is for hopping; `data-row` is what makes `j`, `k`, `gg`,
    // `G` and `zz` work once you are in the rail. A row with only the first is
    // one the motions cannot see.
    expect(/(?:^|\s)data-row(?=\s|$|=)/.test(railRow.text)).toBe(true)
  })
})
