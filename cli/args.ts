import type { ViewId } from './ui/context'

/**
 * What was asked for on the command line.
 *
 * The terminal app was the only thing this binary could do, and the argument
 * handling matched: anything that was not `tui` was dropped on the floor, so
 * `agents-studio tui fleet` silently opened Work and `--port abc` silently
 * meant 3000. Both are the same bug — a CLI that guesses rather than says.
 *
 * The one-shot commands exist because a terminal has something a browser does
 * not: other programs. Every capability here is already an HTTP endpoint, so
 * `agents-studio work --json | jq` costs almost nothing to offer and answers
 * "did the 08:00 ritual pass" without opening anything at all.
 */

export const COMMANDS = ['tui', 'work', 'land', 'daily', 'fleet', 'inbox', 'new', 'watch', 'help'] as const
export type Command = typeof COMMANDS[number]

const VIEWS: ViewId[] = ['work', 'land', 'daily', 'fleet', 'inbox', 'projects']

export interface Invocation {
  command: Command
  /** Machine-readable output, for a pipe. */
  json: boolean
  /** Say nothing; the exit status is the answer. */
  quiet: boolean
  bell: boolean
  port: number
  /** Override the project this invocation is scoped to. */
  project?: string
  /** Which view `tui` opens on. */
  view?: ViewId
  /** A session id to open straight away. */
  session?: string
  /** The instruction, for `new`. */
  prompt?: string
  /** Anything that could not be understood. Non-empty means "print and stop". */
  errors: string[]
}

const FLAGS_WITH_VALUES = new Set(['--port', '-p', '--project', '--view'])

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = {}): Invocation {
  const errors: string[] = []
  const rest: string[] = []

  let command: Command = 'tui'
  let json = false
  let quiet = false
  let bell = true
  let port: number | undefined
  let project: string | undefined
  let view: ViewId | undefined
  let help = false

  const args = [...argv]
  // The first bare word, if it names a command. `agents-studio new "do a thing"`
  // reads as a command and its argument, not as two positionals.
  if (args[0] && COMMANDS.includes(args[0] as Command)) command = args.shift() as Command

  while (args.length) {
    const arg = args.shift()!

    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--quiet' || arg === '-q') {
      quiet = true
      continue
    }
    if (arg === '--no-bell') {
      bell = false
      continue
    }

    const [name, inline] = arg.startsWith('--') && arg.includes('=')
      ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
      : [arg, undefined]

    if (FLAGS_WITH_VALUES.has(name)) {
      const value = inline ?? args.shift()
      if (value === undefined) {
        errors.push(`${name} needs a value.`)
        continue
      }
      if (name === '--port' || name === '-p') {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
          errors.push(`${value} is not a port.`)
        } else {
          port = parsed
        }
      }
      if (name === '--project') project = value
      if (name === '--view') {
        if (!VIEWS.includes(value as ViewId)) errors.push(`No view called ${value}. Try: ${VIEWS.join(', ')}.`)
        else view = value as ViewId
      }
      continue
    }

    if (arg.startsWith('-')) {
      errors.push(`No such option: ${arg}`)
      continue
    }

    rest.push(arg)
  }

  if (help) command = 'help'

  const invocation: Invocation = {
    command,
    json,
    quiet,
    bell,
    port: port ?? portFromEnv(env),
    project,
    view,
    errors,
  }

  if (command === 'new') {
    // Quoted or not: `new fix the flaky test` is what people type, and refusing
    // it to insist on quotes is pedantry the shell does not require.
    invocation.prompt = rest.join(' ').trim()
    if (!invocation.prompt) invocation.errors.push('What should the session work on?')
  } else if (command === 'tui') {
    invocation.session = rest[0]
    if (rest.length > 1) invocation.errors.push(`Too many arguments: ${rest.slice(1).join(' ')}`)
  } else if (rest.length) {
    invocation.errors.push(`Unexpected argument: ${rest[0]}`)
  }

  return invocation
}

function portFromEnv(env: NodeJS.ProcessEnv): number {
  const candidate = Number(env.PORT)
  return Number.isInteger(candidate) && candidate > 0 ? candidate : 3000
}

export function usage(): string {
  return [
    'agents-studio tui                 the app, in this terminal',
    'agents-studio tui --view fleet    open on a view — work land daily fleet inbox projects',
    'agents-studio tui <session-id>    open straight into a session',
    '',
    'agents-studio work                what is in flight, and what wants you',
    'agents-studio land                pull requests with your name on them',
    'agents-studio daily               rituals, when they fire, how they went',
    'agents-studio fleet               everything running, and what today cost',
    'agents-studio inbox               what is waiting elsewhere',
    'agents-studio new <instruction>   start a session on it',
    'agents-studio watch               follow what happens, a line at a time',
    '',
    '  --json          the same answer, for a pipe',
    '  --quiet, -q     say nothing; exit 2 if something needs you',
    '  --project DIR   scope this invocation to a project',
    '  --port N        talk to a server on that port',
    '  --no-bell       do not ring the terminal for prompts',
    '',
    'Connects to the local server, and starts one if nothing is listening.',
    'Quitting does not stop it — rituals keep firing.',
  ].join('\n')
}
