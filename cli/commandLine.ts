import { FILTERS, type RailFilter } from './rail'

export type { RailFilter }
import type { TrustLevel } from './types'

/**
 * The `:` line.
 *
 * For the long tail that does not deserve a key of its own — `:trust full`,
 * `:project ~/code/thing`, `:merge --override`. A vim user's hands already go
 * there, it needs no modal, and unlike a fuzzy palette it is discoverable by
 * typing `:help`. Parsing is here, pure, so the tests can hold the grammar
 * still while `App` decides what each command does.
 */

export type Command =
  | { kind: 'new'; prompt: string }
  | { kind: 'filter'; filter: RailFilter }
  | { kind: 'search'; query: string }
  | { kind: 'project'; path: string | null }
  | { kind: 'trust'; level: TrustLevel }
  | { kind: 'checks' }
  | { kind: 'fix' }
  | { kind: 'update' }
  | { kind: 'merge'; override: boolean }
  | { kind: 'pr' }
  | { kind: 'close' }
  | { kind: 'shell' }
  | { kind: 'editor' }
  | { kind: 'diff' }
  | { kind: 'fleet' }
  | { kind: 'queue' }
  | { kind: 'refresh' }
  | { kind: 'help' }
  | { kind: 'quit' }

export interface Parsed {
  command?: Command
  /** Why not, in words the message line can print. */
  error?: string
}

const TRUST: TrustLevel[] = ['readonly', 'edits', 'full']

/**
 * What is on offer, in the order `:help` lists them. The parser switches on
 * these same names, so a row here with no branch there is a documentation bug
 * that shows up the moment somebody types it.
 */
export const COMMANDS: { name: string; args?: string; label: string }[] = [
  { name: 'new', args: '<instruction>', label: 'Start a session on it' },
  { name: 'only', args: '<what>', label: 'Filter the rail — all, needs-you, sessions, prs, daily, elsewhere, projects' },
  { name: 'find', args: '<text>', label: 'Filter the rail by text' },
  { name: 'project', args: '[path]', label: 'Look at a project, or none' },
  { name: 'trust', args: '<readonly|edits|full>', label: 'How much this session may do without asking' },
  { name: 'checks', label: 'Run the checks' },
  { name: 'fix', label: 'Have it fix its own failing checks' },
  { name: 'update', label: 'Catch it up with the base branch' },
  { name: 'merge', args: '[--override]', label: 'Merge it' },
  { name: 'pr', label: 'Open a pull request' },
  { name: 'close', label: 'Close the session' },
  { name: 'shell', label: 'A shell in the worktree' },
  { name: 'editor', label: '$EDITOR in the worktree' },
  { name: 'diff', label: 'Show the diff' },
  { name: 'fleet', label: 'The fleet, full screen' },
  { name: 'answer', label: 'Work through the waiting prompts' },
  { name: 'refresh', label: 'Refresh everything now' },
  { name: 'help', label: 'This list' },
  { name: 'quit', label: 'Quit' },
]

/** Longer spellings people reach for, and the short ones vim taught them. */
const ALIASES: Record<string, string> = {
  q: 'quit',
  qa: 'quit',
  h: 'help',
  '?': 'help',
  e: 'editor',
  edit: 'editor',
  sh: 'shell',
  f: 'find',
  filter: 'find',
  '/': 'find',
  check: 'checks',
  test: 'checks',
  repair: 'fix',
  rebase: 'update',
  'pull-request': 'pr',
  answer: 'queue',
  prompts: 'queue',
  wall: 'fleet',
  r: 'refresh',
}

/** What `:only` accepts, beyond the filter ids themselves. */
const FILTER_WORDS: Record<string, RailFilter> = {
  everything: 'all',
  blocked: 'needs-you',
  needsyou: 'needs-you',
  sessions: 'session',
  work: 'session',
  prs: 'pull',
  pulls: 'pull',
  land: 'pull',
  daily: 'ritual',
  rituals: 'ritual',
  elsewhere: 'inbox',
  projects: 'project',
}

export function parseCommand(line: string): Parsed {
  const trimmed = line.trim().replace(/^:/, '')
  if (!trimmed) return {}

  const [word = '', ...rest] = trimmed.split(/\s+/)
  const argument = trimmed.slice(word.length).trim()
  const name = ALIASES[word.toLowerCase()] ?? word.toLowerCase()

  switch (name) {
    case 'new':
      return argument
        ? { command: { kind: 'new', prompt: argument } }
        : { error: 'What should the session work on?' }

    case 'only': {
      const filter = filterFrom(argument)
      return filter
        ? { command: { kind: 'filter', filter } }
        : { error: `Nothing called ${argument || 'that'}. Try: ${FILTERS.map(f => f.id).join(', ')}.` }
    }

    case 'find':
      return { command: { kind: 'search', query: argument } }

    case 'project':
      // No argument is "no project", which is a real answer: with none selected
      // the app works against your own `~/.claude` alone.
      return { command: { kind: 'project', path: argument || null } }

    case 'trust': {
      const level = TRUST.find(item => item === argument.toLowerCase())
      return level
        ? { command: { kind: 'trust', level } }
        : { error: `Trust is one of: ${TRUST.join(', ')}.` }
    }

    case 'merge':
      return { command: { kind: 'merge', override: rest.includes('--override') } }

    case 'checks':
    case 'fix':
    case 'update':
    case 'pr':
    case 'close':
    case 'shell':
    case 'editor':
    case 'diff':
    case 'fleet':
    case 'queue':
    case 'refresh':
    case 'help':
    case 'quit':
      return { command: { kind: name } }

    default:
      return { error: `Not a command: ${word}. Type :help.` }
  }
}

/** What `:only` and `--only` accept, in words rather than ids. */
export function filterFrom(argument: string): RailFilter | null {
  const word = argument.toLowerCase().replace(/[\s-]/g, '')
  if (!word) return null
  const direct = FILTERS.find(item => item.id.replace('-', '') === word)
  return direct?.id ?? FILTER_WORDS[word] ?? null
}

/** What `:` should offer when nothing has been typed yet. */
export function completions(line: string): string[] {
  const typed = line.trim().replace(/^:/, '').toLowerCase()
  if (typed.includes(' ')) return []
  return COMMANDS.map(item => item.name).filter(name => name.startsWith(typed))
}
