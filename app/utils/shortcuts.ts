/**
 * The keyboard layer.
 *
 * Everything in this app was reachable with a mouse and three shortcuts — ⌘K,
 * ⌘J, ⌘S — which is fine for a tool you open twice a week and a tax on one you
 * live in all day. Getting from a session to the pull request that came out of
 * it was four clicks through a sidebar you had to aim at.
 *
 * So: `g` then a letter goes anywhere, `j`/`k` walk the list you are looking at,
 * and one key each does the handful of things worth doing from anywhere. The
 * mapping lives here rather than in the listener because the cheatsheet, the
 * palette's hints and the handler all have to agree about what a key does —
 * three copies of that is how a shortcut ends up documented and dead.
 */

export interface NavShortcut {
  /** The key pressed after `g`. */
  key: string
  label: string
  to: string
  /**
   * Hidden in simple mode, matching what the sidebar and the palette hide.
   * A chord to a page the app is deliberately not showing you is the keyboard
   * quietly overruling the mode switch.
   */
  advanced?: boolean
}

/**
 * Mnemonics where the first letter was free, and something defensible where it
 * was not: Land took `l`, so Library is `b` for books; Work took `w`, so
 * Workflows is `f` for flow; Graph took `g` for the chord itself, so it is `r`.
 */
export const NAV_SHORTCUTS: NavShortcut[] = [
  { key: 'n', label: 'Now', to: '/' },
  { key: 'w', label: 'Work', to: '/work' },
  { key: 'l', label: 'Land', to: '/land' },
  { key: 'd', label: 'Daily', to: '/schedules' },
  { key: 'b', label: 'Library', to: '/library' },
  { key: 'f', label: 'Workflows', to: '/workflows', advanced: true },
  { key: 'p', label: 'Plugins', to: '/plugins', advanced: true },
  { key: 'c', label: 'MCP', to: '/mcp', advanced: true },
  { key: 'r', label: 'Graph', to: '/graph', advanced: true },
  { key: 'm', label: 'Fleet', to: '/wall' },
  { key: 'e', label: 'Explore', to: '/explore' },
  { key: 's', label: 'Settings', to: '/settings' },
]

/** The chords on offer in this mode, in the order the cheatsheet lists them. */
export function navShortcuts(isSimple: boolean): NavShortcut[] {
  return NAV_SHORTCUTS.filter(item => !isSimple || !item.advanced)
}

/** Where `g` + this key goes, or null if it goes nowhere from here. */
export function chordTarget(key: string, isSimple: boolean): NavShortcut | null {
  return navShortcuts(isSimple).find(item => item.key === key.toLowerCase()) ?? null
}

/** What to print beside a destination — `g w`, not `gw`, because it is two presses. */
export function chordHint(to: string, isSimple = false): string | null {
  const match = navShortcuts(isSimple).find(item => item.to === to)
  return match ? `g ${match.key}` : null
}

/**
 * The single keys, for the cheatsheet. The handler switches on these same
 * strings, so a row here with no branch there is a documentation bug that shows
 * up the moment somebody presses it.
 */
export interface ActionShortcut {
  keys: string
  label: string
}

export const ACTION_SHORTCUTS: ActionShortcut[] = [
  { keys: '⌘K', label: 'Search and run anything' },
  { keys: '/', label: 'Search — same panel, one key' },
  { keys: ':', label: 'Same panel again, for the other muscle memory' },
  { keys: 'n', label: 'Start a session' },
  { keys: '⌘J', label: 'Ask Claude' },
  { keys: '.', label: 'Collapse or widen the sidebar' },
  { keys: '\\', label: 'Hide or show the session rail' },
  { keys: 't', label: 'Light or dark' },
  { keys: '?', label: 'This list' },
]

/**
 * Walking a list, and — on the work surface — hopping between the pieces of work
 * in it.
 *
 * `j`/`k` move a cursor and leave the pane where it is; `⇧J`/`⇧K` move the pane
 * itself, which is the difference between considering a row and going to it. Both
 * are here rather than in `ACTION_SHORTCUTS` because they are motions, and a
 * count in front of either means what it means in a buffer.
 */
export const LIST_SHORTCUTS: ActionShortcut[] = [
  { keys: 'j', label: 'Next item' },
  { keys: 'k', label: 'Previous item' },
  { keys: '⇧J', label: 'Next session in the rail — and open it' },
  { keys: '⇧K', label: 'Previous one, opened' },
  { keys: '5j', label: 'Five of them — counts work on j, k and G' },
  { keys: 'gg', label: 'First item' },
  { keys: 'G', label: 'Last item, or the nth with a count' },
  { keys: '⌃d', label: 'Half a screen down' },
  { keys: '⌃u', label: 'Half a screen up' },
  { keys: 'zz', label: 'Centre what you are on' },
  { keys: '↵', label: 'Open it' },
  { keys: 'esc', label: 'Let go of it' },
]

export const JUMP_SHORTCUTS: ActionShortcut[] = [
  { keys: '⌃o', label: 'Back, down the jumplist' },
  { keys: '⌃i', label: 'Forward again' },
]

export const EDITOR_SHORTCUTS: ActionShortcut[] = [
  { keys: 'esc', label: 'Leave the box — normal mode, more or less' },
  { keys: '⌘S', label: 'Save what you are editing' },
  { keys: '↵', label: 'Send — in any message box' },
  { keys: '⇧↵', label: 'New line instead' },
]

/** Inside ⌘K, where the arrow keys are not where your hands are. */
export const PALETTE_SHORTCUTS: ActionShortcut[] = [
  { keys: '⌃n / ⌃j', label: 'Down a row' },
  { keys: '⌃p / ⌃k', label: 'Up a row' },
  { keys: '⌃c', label: 'Close it' },
]

/**
 * Whether the keypress landed somewhere a letter means a letter.
 *
 * Inputs, textareas and anything contenteditable, which between them cover
 * every box in the app — including xterm, whose keyboard input is a hidden
 * textarea, and the code editor, which is a plain textarea on purpose.
 * `isContentEditable` rather than the attribute because an inherited
 * `contenteditable` does not put the attribute on the child that has focus.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false

  const tag = el.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true

  // A row you have arrowed onto is not a typing target, but a listbox you are
  // driving with the arrow keys owns them.
  return el.getAttribute?.('role') === 'combobox'
}

/**
 * Whether Enter on this element already does something without our help.
 *
 * The rows that were keyboard-reachable first are all links — `EntityRow`,
 * `RunCard`, `SessionCard` — and the browser opens a focused anchor on Enter by
 * itself. Clicking it again from the handler would open it twice, which on a
 * `NuxtLink` is a duplicate navigation and on a `target="_blank"` one is two
 * tabs.
 */
export function opensItself(el: HTMLElement | null): boolean {
  const tag = el?.tagName?.toLowerCase()
  if (!tag) return false
  if (tag === 'button') return true
  return tag === 'a' && el!.hasAttribute('href')
}

/**
 * What Enter should press on a row that is not itself a link.
 *
 * Declared by the row rather than guessed at, because "the first link inside"
 * is wrong on every row that has two: a `PullCard` for work you have already
 * started leads with a chip linking to that session, and the pull request — the
 * thing the row is about — is the second anchor. A row that means to be openable
 * says which element it opens.
 *
 * Null is a legitimate answer. An MCP server that is connected and a marketplace
 * source have no destination to go to, and inventing one out of the nearest
 * button would make Enter install things.
 */
export function rowAction(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>('[data-row-open]')
}

/**
 * Whether the keypress is inside the embedded shell.
 *
 * Everything else that swallows keys does it because a letter is a letter; this
 * one is stronger. Somebody running nvim in the dock needs Escape, ⌃d, ⌃o and
 * every other key in this file to reach the pty untouched — an app that eats
 * Escape out from under a terminal is broken in a way no shortcut is worth.
 */
export function isTerminalTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return Boolean(el?.closest?.('.xterm'))
}

/**
 * Whether a bare key should be treated as a shortcut at all.
 *
 * Any modifier means the browser, the OS or one of this app's own ⌘ shortcuts
 * has a claim on it first — ⌘L is the address bar and always will be.
 */
export function isBareKey(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey
}

/**
 * Whether this keypress is the rail's toggle.
 *
 * `\` is not a bare key on every keyboard. An ISO layout puts it behind Option —
 * ⌥ç on Spanish, ⌥⇧7 on German — so `isBareKey` threw it away, and the one
 * control that gets a hidden rail back was unreachable on any layout that is not
 * American. What it typed is what matters, not which modifier the OS needed to
 * type it, so this reads `key` and forgives ⌥.
 *
 * ⌘ and ⌃ are not forgiven. Those belong to the browser and the shell, and no
 * layout composes a backslash with either.
 */
export function isRailToggle(event: KeyboardEvent): boolean {
  return event.key === '\\' && !event.metaKey && !event.ctrlKey
}

/**
 * How long a half-pressed chord waits for its second key.
 *
 * Long enough to be a two-finger sequence rather than a race, short enough that
 * a `g` you pressed by accident is not still armed when you go back to typing.
 */
export const CHORD_TIMEOUT_MS = 1600
