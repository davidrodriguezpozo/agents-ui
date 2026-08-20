/**
 * Every key the terminal app answers to, in one list — and the list is what
 * answers them.
 *
 * It began as documentation the handlers happened to agree with, which is one
 * copy better than the three it replaced but still leaves the table describing
 * behaviour rather than deciding it. Now each binding carries what to press, a
 * handler asks `matches('session.checks', input, key)`, and remapping is a file
 * of overrides rather than a patch.
 *
 * Nothing here binds anything to an action. A view asks whether a key was this
 * binding and decides what that means; the branch stays with the state it
 * touches.
 */

/** Which surface a key belongs to. */
export type Surface =
  | 'global'
  | 'rail'
  | 'session'
  | 'diff'
  | 'run'
  | 'pull'
  | 'ritual'
  | 'inbox'
  | 'project'
  | 'queue'
  | 'fleet'

/**
 * A key to press, as a small string: `c`, `C`, `ctrl+d`, `esc`, `enter`,
 * `tab`, `shift+tab`. Two-key chords are not here — `g w` is a sequence, and
 * sequences are `App`'s business because they need a buffer.
 */
export type Press = string

export interface Binding {
  id: string
  /** As printed: `⏎`, `g g`, `⌃d`. */
  keys: string
  label: string
  surface: Surface
  /** What a footer calls it, when the sentence is too long for one. */
  short?: string
  /** What to press. Empty for chords and motions `App` reads directly. */
  press?: Press[]
  /**
   * Spends money, writes to a remote, or destroys work — so the view asks
   * first. Marked here rather than remembered at each call site, because the
   * reason `m` needed a confirmation and `D` already had one was nothing but
   * the order they were written in.
   */
  confirm?: boolean
}

export const BINDINGS: Binding[] = [
  // Everywhere.
  { id: 'focus', keys: 'tab', label: 'Move between the rail and the pane', short: 'focus', surface: 'global', press: ['tab', 'ctrl+w'] },
  { id: 'queue', keys: 'Y', label: 'Answer everything that is waiting', short: 'answer all', surface: 'global', press: ['Y'] },
  { id: 'fleet', keys: 'F', label: 'The fleet, full screen', short: 'fleet', surface: 'global', press: ['F'] },
  { id: 'command', keys: ':', label: 'Run a command', short: 'command', surface: 'global', press: [':'] },
  { id: 'filter', keys: '/', label: 'Filter the rail', short: 'filter', surface: 'global', press: ['/'] },
  { id: 'filters', keys: 'g s', label: 'What the rail shows — a s p d i j, and g m for the fleet', short: 'filters', surface: 'global' },
  { id: 'unread', keys: '⌃n', label: 'Next thing that has said something since you looked', short: 'next unread', surface: 'global', press: ['ctrl+n'] },
  { id: 'jumps', keys: '⌃o ⌃i', label: 'Back and forward, where you were', short: 'back', surface: 'global', press: [] },
  { id: 'project.cycle', keys: '[ ]', label: 'Previous / next project', short: 'project', surface: 'global', press: ['[', ']'] },
  { id: 'refresh', keys: 'r', label: 'Refresh now', short: 'refresh', surface: 'global', press: ['r'] },
  { id: 'browser', keys: 'o', label: 'Open this in the browser', short: 'browser', surface: 'global', press: ['o'] },
  { id: 'help', keys: '?', label: 'The keys for where you are', short: 'keys', surface: 'global', press: ['?'] },
  { id: 'quit', keys: 'q', label: 'Quit — the server keeps running', short: 'quit', surface: 'global', press: ['q'] },

  // Moving, in the rail or a pane. Read by `App` and published as motions, so
  // they mean the same thing to a list and to a transcript.
  { id: 'move', keys: 'j k', label: 'Move', short: 'move', surface: 'rail' },
  { id: 'move.count', keys: '5j', label: 'Five of them — counts work on j, k and G', surface: 'rail' },
  { id: 'move.first', keys: 'g g', label: 'First row, oldest line', surface: 'rail' },
  { id: 'move.last', keys: 'G', label: 'Last row, newest line, or the nth with a count', surface: 'rail' },
  { id: 'move.half', keys: '⌃d ⌃u', label: 'Half a screen', surface: 'rail' },

  // The rail.
  { id: 'rail.open', keys: '⏎', label: 'Look at it in the pane', short: 'open', surface: 'rail', press: ['enter'] },
  { id: 'rail.new', keys: 'n', label: 'Start a session', short: 'new', surface: 'rail', press: ['n'] },
  { id: 'rail.adopt', keys: 'a', label: 'Continue a terminal conversation here', short: 'adopt one', surface: 'rail', press: ['a'] },
  { id: 'rail.stop', keys: 'x', label: 'Stop a run · dismiss an item · no project', short: 'stop', surface: 'rail', press: ['x'] },
  { id: 'rail.toggle', keys: 'e', label: 'Enable or disable a ritual', short: 'on/off', surface: 'rail', press: ['e'] },
  { id: 'rail.run', keys: 'R', label: 'Run a ritual now · look at a source again', short: 'run now', surface: 'rail', press: ['R'], confirm: true },
  { id: 'rail.merge', keys: 'm', label: 'Merge it', short: 'merge', surface: 'rail', press: ['m'], confirm: true },
  { id: 'rail.default', keys: 'S', label: 'Make this project the app default', short: 'make default', surface: 'rail', press: ['S'] },

  // A session in the pane.
  { id: 'session.write', keys: 'i', label: 'Write an instruction', short: 'write', surface: 'session', press: ['i'] },
  { id: 'session.editor', keys: 'I', label: 'Write it in $EDITOR', short: 'write in $EDITOR', surface: 'session', press: ['I'] },
  { id: 'session.scroll', keys: 'j k ⌃d ⌃u', label: 'Scroll', short: 'scroll', surface: 'session' },
  { id: 'session.diff', keys: 'd', label: 'The diff', short: 'diff', surface: 'session', press: ['d'] },
  { id: 'session.steps', keys: 'z', label: 'Open or close what it did, on the turn you are reading', short: 'steps', surface: 'session', press: ['z'] },
  { id: 'session.stepsAll', keys: 'Z', label: 'Open or close what it did, everywhere', short: 'all steps', surface: 'session', press: ['Z'] },
  { id: 'session.checks', keys: 'c', label: 'Run the checks', short: 'checks', surface: 'session', press: ['c'] },
  { id: 'session.repair', keys: 'f', label: 'Have it fix its own failing checks', short: 'fix checks', surface: 'session', press: ['f'] },
  { id: 'session.update', keys: 'u', label: 'Catch it up with the base branch', short: 'catch up', surface: 'session', press: ['u'] },
  { id: 'session.trust', keys: 't', label: 'How much it is trusted', short: 'trust', surface: 'session', press: ['t'] },
  { id: 'session.stop', keys: 'x', label: 'Stop the run', short: 'stop', surface: 'session', press: ['x'] },
  { id: 'session.shell', keys: 's', label: 'A shell in the worktree', short: 'shell', surface: 'session', press: ['s'] },
  { id: 'session.worktree', keys: 'e', label: '$EDITOR in the worktree', short: 'editor', surface: 'session', press: ['e'] },
  { id: 'session.pr', keys: 'p', label: 'Open a pull request', short: 'pull request', surface: 'session', press: ['p'], confirm: true },
  { id: 'session.merge', keys: 'm', label: 'Merge into the base branch', short: 'merge', surface: 'session', press: ['m'], confirm: true },
  { id: 'session.close', keys: 'D', label: 'Close it and remove the worktree', short: 'close', surface: 'session', press: ['D'], confirm: true },
  { id: 'session.allow', keys: 'y a', label: 'Allow once · allow for this run', short: 'allow once', surface: 'session', press: ['y', 'a'] },
  { id: 'session.deny', keys: 'n N', label: 'Deny · deny and say why', short: 'deny', surface: 'session', press: ['n', 'N'] },
  { id: 'session.back', keys: 'esc', label: 'Back to the rail', short: 'rail', surface: 'session', press: ['esc'] },

  // The diff.
  { id: 'diff.file', keys: 'n N', label: 'Next file · the one before', short: 'next file', surface: 'diff', press: ['n', 'N'] },
  { id: 'diff.back', keys: 'd', label: 'Back to the conversation', short: 'back', surface: 'diff', press: ['d', 'esc'] },

  // A run.
  { id: 'run.scroll', keys: 'j k ⌃d ⌃u', label: 'Scroll the output', short: 'scroll', surface: 'run' },
  { id: 'run.back', keys: 'esc', label: 'Back to the rail', short: 'rail', surface: 'run', press: ['esc'] },

  // A pull request.
  { id: 'pull.work', keys: 'w', label: 'Start a session on it', short: 'work on it', surface: 'pull', press: ['w'] },
  { id: 'pull.merge', keys: 'm', label: 'Merge it', short: 'merge', surface: 'pull', press: ['m'], confirm: true },

  // A ritual.
  { id: 'ritual.toggle', keys: 'e', label: 'Enable or disable it', short: 'on/off', surface: 'ritual', press: ['e'] },
  { id: 'ritual.run', keys: 'R', label: 'Run it now', short: 'run now', surface: 'ritual', press: ['R'], confirm: true },

  // Something waiting elsewhere.
  { id: 'inbox.look', keys: 'R', label: 'Look again — this one costs money', short: 'look again', surface: 'inbox', press: ['R'], confirm: true },
  { id: 'inbox.dismiss', keys: 'x', label: 'Dismiss it', short: 'dismiss', surface: 'inbox', press: ['x'] },

  // A project.
  { id: 'project.focus', keys: '⏎', label: 'Look at this one', short: 'look here', surface: 'project', press: ['enter'] },
  { id: 'project.default', keys: 'S', label: 'Also make it the app default', short: 'make default', surface: 'project', press: ['S'] },

  // The queue of waiting prompts.
  { id: 'queue.allow', keys: 'y', label: 'Allow it, once', short: 'once', surface: 'queue', press: ['y'] },
  { id: 'queue.session', keys: 'a', label: 'Allow it for the rest of this run', short: 'for the run', surface: 'queue', press: ['a'] },
  { id: 'queue.deny', keys: 'n', label: 'Deny it', short: 'deny', surface: 'queue', press: ['n'] },
  { id: 'queue.reason', keys: 'N', label: 'Deny it and say why', short: 'say why', surface: 'queue', press: ['N'] },
  { id: 'queue.skip', keys: 's', label: 'Leave it for now and move on', short: 'skip', surface: 'queue', press: ['s'] },
  { id: 'queue.open', keys: '⏎', label: 'Open the session it came from', short: 'open', surface: 'queue', press: ['enter'] },
  { id: 'queue.leave', keys: 'esc', label: 'Stop answering', short: 'leave', surface: 'queue', press: ['esc'] },

  // The fleet.
  { id: 'fleet.stop', keys: 'x', label: 'Stop the run', short: 'stop', surface: 'fleet', press: ['x'] },
  { id: 'fleet.leave', keys: 'esc', label: 'Back to the rail', short: 'rail', surface: 'fleet', press: ['esc', 'F'] },
]

/** What Ink tells a handler about a keypress, narrowed to what is matched on. */
export interface KeyState {
  ctrl?: boolean
  shift?: boolean
  escape?: boolean
  return?: boolean
  tab?: boolean
  upArrow?: boolean
  downArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
}

const NAMED: Record<string, keyof KeyState> = {
  esc: 'escape',
  enter: 'return',
  tab: 'tab',
  up: 'upArrow',
  down: 'downArrow',
  pageup: 'pageUp',
  pagedown: 'pageDown',
}

/** Does this press describe the key that just arrived? */
export function pressMatches(press: Press, input: string, key: KeyState): boolean {
  const parts = press.toLowerCase().split('+')
  const wantsCtrl = parts.includes('ctrl')
  const wantsShift = parts.includes('shift')
  const last = parts[parts.length - 1]!

  if (wantsCtrl !== Boolean(key.ctrl)) return false

  const named = NAMED[last]
  if (named) {
    if (!key[named]) return false
    // `shift+tab` is a different key from `tab`, and the only named one where
    // the distinction is worth making.
    return wantsShift ? Boolean(key.shift) : !key.shift || last !== 'tab'
  }

  // A literal, and case is the whole difference between `r` and `R`.
  const wanted = press.slice(press.lastIndexOf('+') + 1)
  return input === wanted
}

export interface Keymap {
  binding: (id: string) => Binding
  bindingsFor: (surface: Surface) => Binding[]
  matches: (id: string, input: string, key: KeyState) => boolean
  hint: (ids: string[]) => string
  keysOf: (id: string) => string
  needsConfirm: (id: string) => boolean
}

/**
 * The keymap, with a person's own keys folded in.
 *
 * Overrides are id → press, so `{"session.checks": "C"}` moves the checks. The
 * printed form moves with it, because the help page and the footers read the
 * same binding the handler does.
 */
export function createKeymap(overrides: Record<string, string> = {}): Keymap {
  const bindings = BINDINGS.map((item) => {
    const override = overrides[item.id]
    if (!override) return item
    return { ...item, press: [override], keys: printable(override) }
  })

  const byId = new Map(bindings.map(item => [item.id, item]))

  const binding = (id: string): Binding => {
    const found = byId.get(id)
    // Thrown rather than shrugged off: a hint asking for a key that does not
    // exist is the drift this table was written to make impossible, and it
    // should fail in the test suite rather than print a blank.
    if (!found) throw new Error(`No such binding: ${id}`)
    return found
  }

  const label = (id: string): string => {
    const item = binding(id)
    if (item.short) return item.short
    const first = item.label.split(/ — |, | · /)[0]!
    return first.charAt(0).toLowerCase() + first.slice(1)
  }

  return {
    binding,
    bindingsFor: surface => bindings.filter(item => item.surface === surface),
    matches: (id, input, key) => (binding(id).press ?? []).some(press => pressMatches(press, input, key)),
    /**
     * `⏎ open   n new   tab history` — three spaces, because two read as one
     * word at the widths this runs at.
     */
    hint: ids => ids.map(id => `${binding(id).keys} ${label(id)}`).join('   '),
    keysOf: id => binding(id).keys,
    needsConfirm: id => Boolean(binding(id).confirm),
  }
}

/** `ctrl+n` as `⌃n`, so an overridden key prints like the built-in ones. */
export function printable(press: Press): string {
  const parts = press.split('+')
  const last = parts[parts.length - 1]!
  const glyph = last === 'enter' ? '⏎' : last === 'esc' ? 'esc' : last
  return parts.includes('ctrl') ? `⌃${glyph}` : glyph
}

const DEFAULT = createKeymap()

export const binding = DEFAULT.binding
export const bindingsFor = DEFAULT.bindingsFor
export const hint = DEFAULT.hint
export const needsConfirm = DEFAULT.needsConfirm
export const matches = DEFAULT.matches
