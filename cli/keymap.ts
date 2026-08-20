/**
 * Every key the terminal app answers to, in one list.
 *
 * There were three copies of this — the footer string in `App.tsx`, a `hint`
 * on each inspector, and the help page — and they had already drifted: help
 * did not mention `p`, `m`, `D`, `s` or `tab`, and the footer promised
 * "⏎ open" on Projects, where Enter switches project. The browser hit the same
 * wall and solved it the same way in `app/utils/shortcuts.ts`: the handler, the
 * cheatsheet and the hints all read one table, so a key that is documented and
 * dead cannot survive a `grep`.
 *
 * Nothing here binds anything. A view asks for the keys it offers and gets the
 * line to print; the branch that acts on the key lives with the view, which is
 * where the state is.
 */

/** Which surface a key belongs to. `list` is every view that is a list. */
export type Surface =
  | 'global'
  | 'list'
  | 'work'
  | 'land'
  | 'daily'
  | 'fleet'
  | 'inbox'
  | 'projects'
  | 'session'
  | 'diff'
  | 'run'

export interface Binding {
  id: string
  /** As printed: `⏎`, `g g`, `⌃d`. Two presses are two glyphs with a space. */
  keys: string
  label: string
  surface: Surface
  /**
   * What a footer calls it, when the sentence is too long for one.
   *
   * `h l previous / next view` is a third of the line; `h l views` is the same
   * fact. The help page has room for the sentence and prints that instead.
   */
  short?: string
  /**
   * Spends money, writes to a remote, or destroys work — so the view asks
   * first. Marked here rather than remembered at each call site, because the
   * reason `m` needed a confirmation and `D` already had one was nothing but
   * the order they were written in.
   */
  confirm?: boolean
}

export const BINDINGS: Binding[] = [
  // Global.
  { id: 'views', keys: 'h l', label: 'Previous / next view', surface: 'global', short: 'views' },
  { id: 'views.chord', keys: 'g w', label: 'Straight to a view — w l d m i p, as in the browser', surface: 'global' },
  { id: 'project.cycle', keys: '[ ]', label: 'Previous / next project', surface: 'global', short: 'project' },
  { id: 'help', keys: '?', label: 'This page', surface: 'global', short: 'keys' },
  { id: 'quit', keys: 'q', label: 'Quit — the server keeps running', surface: 'global' },

  // Any list.
  { id: 'move', keys: 'j k', label: 'Move', surface: 'list' },
  { id: 'move.count', keys: '5j', label: 'Five of them — counts work on j, k and G', surface: 'list' },
  { id: 'move.first', keys: 'g g', label: 'First row', surface: 'list' },
  { id: 'move.last', keys: 'G', label: 'Last row, or the nth with a count', surface: 'list' },
  { id: 'move.half', keys: '⌃d ⌃u', label: 'Half a screen', surface: 'list' },
  { id: 'open', keys: '⏎', label: 'Open it', surface: 'list', short: 'open' },
  { id: 'filter', keys: '/', label: 'Filter', surface: 'list' },
  { id: 'refresh', keys: 'r', label: 'Refresh now', surface: 'list', short: 'refresh' },
  { id: 'browser', keys: 'o', label: 'Open this in the browser', surface: 'list', short: 'browser' },

  // Work.
  { id: 'work.new', keys: 'n', label: 'Start a session', surface: 'work', short: 'new' },
  { id: 'work.adopt', keys: 'a', label: 'Continue a terminal conversation here', surface: 'work', short: 'adopt one' },
  { id: 'work.tab', keys: 'tab', label: 'In flight / history', surface: 'work', short: 'history' },

  // Land.
  { id: 'land.work', keys: '⏎', label: 'Start a session on it', surface: 'land', short: 'work on it' },
  { id: 'land.merge', keys: 'm', label: 'Merge it', surface: 'land', confirm: true, short: 'merge' },

  // Daily.
  { id: 'daily.history', keys: '⏎', label: 'What it has been doing', surface: 'daily', short: 'history' },
  { id: 'daily.toggle', keys: 'e', label: 'Enable or disable it', surface: 'daily', short: 'on/off' },
  { id: 'daily.run', keys: 'R', label: 'Run it now', surface: 'daily', confirm: true, short: 'run now' },

  // Fleet.
  { id: 'fleet.stop', keys: 'x', label: 'Stop the run', surface: 'fleet', short: 'stop' },

  // Inbox.
  { id: 'inbox.look', keys: 'R', label: 'Look again — this one costs money', surface: 'inbox', confirm: true, short: 'look again' },
  { id: 'inbox.dismiss', keys: 'x', label: 'Dismiss it', surface: 'inbox', short: 'dismiss' },

  // Projects.
  { id: 'projects.focus', keys: '⏎', label: 'Look at this one', surface: 'projects', short: 'look here' },
  { id: 'projects.default', keys: 'S', label: 'Also make it the app default', surface: 'projects', short: 'make default' },
  { id: 'projects.clear', keys: 'x', label: 'No project — just ~/.claude', surface: 'projects', short: 'no project' },

  // A session.
  { id: 'session.write', keys: 'i', label: 'Write an instruction', surface: 'session', short: 'write' },
  { id: 'session.back', keys: 'esc', label: 'Back', surface: 'session' },
  { id: 'session.scroll', keys: 'j k ⌃d ⌃u', label: 'Scroll the transcript', surface: 'session', short: 'scroll' },
  { id: 'session.ends', keys: 'g G', label: 'Oldest / newest', surface: 'session' },
  { id: 'session.diff', keys: 'd', label: 'The diff', surface: 'session', short: 'diff' },
  { id: 'session.checks', keys: 'c', label: 'Run the checks', surface: 'session', short: 'checks' },
  { id: 'session.repair', keys: 'f', label: 'Have it fix its own failing checks', surface: 'session', short: 'fix checks' },
  { id: 'session.update', keys: 'u', label: 'Catch it up with the base branch', surface: 'session', short: 'catch up' },
  { id: 'session.trust', keys: 't', label: 'How much it is trusted', surface: 'session', short: 'trust' },
  { id: 'session.stop', keys: 'x', label: 'Stop the run', surface: 'session', short: 'stop' },
  { id: 'session.shell', keys: 's', label: 'A shell in the worktree', surface: 'session', short: 'shell' },
  { id: 'session.editor', keys: 'e', label: '$EDITOR in the worktree', surface: 'session', short: 'editor' },
  { id: 'session.pr', keys: 'p', label: 'Open a pull request', surface: 'session', confirm: true },
  { id: 'session.merge', keys: 'm', label: 'Merge into the base branch', surface: 'session', confirm: true, short: 'merge' },
  { id: 'session.close', keys: 'D', label: 'Close it and remove the worktree', surface: 'session', confirm: true, short: 'close' },
  { id: 'session.allow', keys: 'y a', label: 'Allow once · allow for this run', surface: 'session' },
  { id: 'session.deny', keys: 'n N', label: 'Deny · deny and say why', surface: 'session' },

  // The diff pane.
  { id: 'diff.file', keys: 'tab', label: 'Next file — ⇧tab for the one before', surface: 'diff', short: 'next file' },
  { id: 'diff.back', keys: 'esc', label: 'Back to the conversation', surface: 'diff', short: 'back' },

  // A run.
  { id: 'run.back', keys: 'esc', label: 'Back', surface: 'run' },
  { id: 'run.scroll', keys: 'j k ⌃d ⌃u', label: 'Scroll the output', surface: 'run', short: 'scroll' },
]

const BY_ID = new Map(BINDINGS.map(binding => [binding.id, binding]))

export function binding(id: string): Binding {
  const found = BY_ID.get(id)
  // Thrown rather than shrugged off: a hint asking for a key that does not
  // exist is the drift this table was written to make impossible, and it should
  // fail in the test suite rather than print a blank.
  if (!found) throw new Error(`No such binding: ${id}`)
  return found
}

export function bindingsFor(surface: Surface): Binding[] {
  return BINDINGS.filter(item => item.surface === surface)
}

/**
 * The footer line for a handful of keys, in the order given.
 *
 * `⏎ open   n new   tab history` — three spaces, because two read as one word
 * at the widths this runs at.
 */
export function hint(ids: string[]): string {
  return ids.map(id => `${binding(id).keys} ${label(id)}`).join('   ')
}

/**
 * The short form for a footer: the first clause of the label, lowercased.
 *
 * Help has room for "Have it fix its own failing checks"; a footer does not,
 * and truncating the sentence would cut it mid-word. Written as one rule so
 * every footer shortens the same way.
 */
function label(id: string): string {
  const item = binding(id)
  if (item.short) return item.short
  const first = item.label.split(/ — |, | · /)[0]!
  return first.charAt(0).toLowerCase() + first.slice(1)
}

/** Does this key want asking first? */
export function needsConfirm(id: string): boolean {
  return Boolean(binding(id).confirm)
}
