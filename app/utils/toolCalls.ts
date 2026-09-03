/**
 * What a tool call was actually doing.
 *
 * A run's steps arrive as a tool name and a bag of arguments — `Edit` with a
 * `file_path`, `Bash` with a `command`. Printed raw that is noise, and the
 * useful part (which file, which command) is buried in it. This turns each one
 * into the line a person would have written: a verb and a target.
 */

export interface ToolCallLike {
  /** Present on both real shapes; the describer itself never needs it. */
  id?: string
  toolName: string
  input?: unknown
  result?: string
  isError?: boolean
}

export interface ToolActivity {
  verb: string
  target: string
  icon: string
  /** Set when the call touched a file, which is what "files touched" counts. */
  path?: string
  /** True when the call changed something rather than just looking. */
  writes: boolean
}

const FIELDS = ['file_path', 'notebook_path', 'path', 'command', 'pattern', 'url', 'query', 'description', 'prompt']

function field(input: unknown, name: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** The first argument worth showing, for a tool we have no specific rule for. */
function anyField(input: unknown): string | undefined {
  for (const name of FIELDS) {
    const value = field(input, name)
    if (value) return value
  }
  return undefined
}

/** The text of the first question in an `AskUserQuestion` call, if it has one. */
function firstQuestion(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const questions = (input as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return undefined
  return field(questions[0], 'question')
}

/**
 * Paths are absolute inside a worktree, and the worktree path is long and the
 * same for every line. What distinguishes one step from another is the tail.
 */
export function shortenPath(path: string, root?: string): string {
  let short = path
  if (root && short.startsWith(root)) short = short.slice(root.length)
  short = short.replace(/^\/+/, '')

  const parts = short.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : short
}

export function describeToolCall(call: ToolCallLike, root?: string): ToolActivity {
  const { toolName, input } = call
  const file = field(input, 'file_path') || field(input, 'notebook_path')

  switch (toolName) {
    case 'Read':
      return { verb: 'Read', target: file ? shortenPath(file, root) : '', icon: 'i-lucide-file-text', path: file, writes: false }
    case 'Edit':
    case 'MultiEdit':
      return { verb: 'Edited', target: file ? shortenPath(file, root) : '', icon: 'i-lucide-file-pen', path: file, writes: true }
    case 'Write':
      return { verb: 'Wrote', target: file ? shortenPath(file, root) : '', icon: 'i-lucide-file-plus', path: file, writes: true }
    case 'NotebookEdit':
      return { verb: 'Edited', target: file ? shortenPath(file, root) : '', icon: 'i-lucide-notebook-pen', path: file, writes: true }
    case 'Bash':
    case 'BashOutput':
      return { verb: 'Ran', target: field(input, 'command') ?? '', icon: 'i-lucide-terminal', writes: true }
    case 'Grep':
      return { verb: 'Searched for', target: field(input, 'pattern') ?? '', icon: 'i-lucide-search', writes: false }
    case 'Glob':
      return { verb: 'Looked for', target: field(input, 'pattern') ?? '', icon: 'i-lucide-folder-search', writes: false }
    case 'Task':
    case 'Agent':
      return { verb: 'Delegated', target: field(input, 'description') ?? field(input, 'prompt') ?? '', icon: 'i-lucide-bot', writes: false }
    case 'WebFetch':
      return { verb: 'Fetched', target: field(input, 'url') ?? '', icon: 'i-lucide-globe', writes: false }
    case 'WebSearch':
      return { verb: 'Searched the web for', target: field(input, 'query') ?? '', icon: 'i-lucide-globe', writes: false }
    case 'TodoWrite':
      return { verb: 'Updated the plan', target: '', icon: 'i-lucide-list-checks', writes: false }
    case 'AskUserQuestion':
      // The one tool whose input is a question rather than a target, so the
      // question itself is the only thing worth putting on the row.
      return { verb: 'Asked', target: firstQuestion(input) ?? '', icon: 'i-lucide-message-circle-question', writes: false }
    default:
      // Unknown tools still say something, rather than rendering as a blank row.
      return { verb: toolName, target: anyField(input) ?? '', icon: 'i-lucide-wrench', writes: false }
  }
}

/**
 * The files a turn changed, in the order it first touched them. Reading a file
 * does not count — the interesting question is what is different now.
 */
export function filesTouched(calls: ToolCallLike[], root?: string): string[] {
  const seen: string[] = []

  for (const call of calls) {
    const { path, writes } = describeToolCall(call, root)
    if (!writes || !path) continue

    const short = shortenPath(path, root)
    if (!seen.includes(short)) seen.push(short)
  }

  return seen
}

/**
 * The same verb, in the present tense.
 *
 * `describeToolCall` is written for things that have happened — "Edited", "Ran" —
 * which is right for a log and wrong for a question. A permission prompt asks
 * about something that has *not* happened yet, and "wants to Ran gh pr create" is
 * what you get from reusing the wrong tense.
 */
const PRESENT: Record<string, string> = {
  Read: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'write',
  NotebookEdit: 'edit',
  Bash: 'run',
  BashOutput: 'run',
  Grep: 'search for',
  Glob: 'look for',
  Task: 'delegate',
  Agent: 'delegate',
  WebFetch: 'fetch',
  WebSearch: 'search the web for',
  TodoWrite: 'update the plan',
  AskUserQuestion: 'ask you something',
}

export function presentVerb(toolName: string): string {
  return PRESENT[toolName] ?? `use ${toolName}`
}
