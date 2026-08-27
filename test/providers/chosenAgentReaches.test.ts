import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * The chosen agent has to reach every way of starting work, not just the box.
 *
 * "Which agent" was honoured by exactly three routes — the sessions box, the
 * batch and the race — and silently ignored by everything else. A repository set
 * to Cursor still ran Claude Code for the rows on Land, for a branch or pull
 * request started by ref, for the reply that starts a session from the digest,
 * for a session started over MCP, for every ritual, and for every workflow step.
 * Nothing said so: the setting reported "Chosen for this repository" and the
 * work went to the other agent.
 *
 * Two tests, because the bug had two halves.
 *
 * The first is behavioural: `startSessionFromRef` is where the Land rows end up,
 * and it has to record the choice on a workspace it cuts *and* leave a session it
 * continues alone — a conversation lives inside one agent's history, so an
 * existing session keeps the agent it was started with whatever the repository
 * now says.
 *
 * The second reads the source, and it is the one that would have caught this.
 * The defect was never in a function; it was in the seven callers that did not
 * pass an argument. Nothing short of looking at all of them notices that.
 */

const SERVER = new URL('../../server/', import.meta.url).pathname

let root: string
let repo: string
let fromRef: typeof import('../../server/utils/sessionFromRef')
let sessions: typeof import('../../server/utils/sessions')

function git(args: string[], cwd = repo) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

beforeAll(async () => {
  // Never the real ~/.claude, which holds live sessions and worktrees.
  root = await mkdtemp(join(tmpdir(), 'agents-ui-chosen-agent-'))
  process.env.CLAUDE_DIR = join(root, 'claude')
  fromRef = await import('../../server/utils/sessionFromRef')
  sessions = await import('../../server/utils/sessions')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  repo = await mkdtemp(join(root, 'repo-'))

  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'README.md'), '# hello\n')
  git(['add', '.'])
  git(['commit', '-m', 'first'])

  git(['branch', 'feature-x'])
  await sessions.writeSessions([])
})

describe('starting on work that already exists', () => {
  it('records the chosen agent on the workspace it cuts', async () => {
    const { session, how } = await fromRef.startSessionFromRef({
      repoDir: repo,
      ref: 'feature-x',
      provider: 'cursor',
    })

    expect(how).toBe('created')
    expect(session.provider).toBe('cursor')
    // Not only on the object handed back — on what the turn will read.
    expect((await sessions.findSession(session.id))?.provider).toBe('cursor')
  })

  /**
   * A review is a detached checkout of the commit, which is a different path
   * through the same function and was the one the Land page used most.
   */
  it('records it on a review too', async () => {
    const { session } = await fromRef.startSessionFromRef({
      repoDir: repo,
      ref: 'feature-x',
      detach: true,
      provider: 'cursor',
    })

    expect(session.detached).toBe(true)
    expect(session.provider).toBe('cursor')
  })

  it('records nothing when nobody chose, which reads as Claude Code', async () => {
    const { session } = await fromRef.startSessionFromRef({ repoDir: repo, ref: 'feature-x' })
    expect(session.provider).toBeUndefined()
  })

  /**
   * The repository's default changing must not move an open conversation. The
   * second press lands in the workspace that already has the branch, and that
   * session's history lives inside the agent it was started with.
   */
  it('leaves a session it continues on the agent it was started with', async () => {
    const first = await fromRef.startSessionFromRef({
      repoDir: repo,
      ref: 'feature-x',
      provider: 'cursor',
    })

    const second = await fromRef.startSessionFromRef({
      repoDir: repo,
      ref: 'feature-x',
      provider: 'claude',
    })

    expect(second.how).toBe('continued')
    expect(second.session.id).toBe(first.session.id)
    expect(second.session.provider).toBe('cursor')
  })
})

/**
 * Where a session or a run is made, and whether that call says which agent.
 *
 * Deliberately textual. The alternative is to exercise a dozen endpoints, each
 * needing GitHub, Notion, a scheduler tick or an MCP client — and the thing being
 * checked is not what any of them returns, it is whether one argument is present
 * at the call. Reading the call is both cheaper and closer to the defect.
 */
const MAKERS = ['startSession', 'startSessionFromRef', 'createRun']

/**
 * Calls that are right to leave on Claude Code, each for a reason that is
 * written next to it in the source as well as here.
 */
const EXEMPT: Record<string, string> = {
  'api/transcripts/adopt.post.ts':
    'resumes a Claude Code transcript by an id only Claude Code can resume',
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') ? [path] : []
  })
}

/** The argument object of a `name({ … })` call, from `{` to its matching `}`. */
function callArguments(source: string, openBrace: number): string {
  let depth = 0
  for (let i = openBrace; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(openBrace, i + 1)
  }
  return source.slice(openBrace)
}

describe('every way of starting work', () => {
  it('says which agent takes it', async () => {
    const silent: string[] = []

    for (const path of sourceFiles(SERVER)) {
      const where = relative(SERVER, path)
      if (where in EXEMPT) continue

      const source = await readFile(path, 'utf8')

      for (const maker of MAKERS) {
        // `maker({` only — the declarations read `maker(options: {` and
        // `maker(input: …)`, so this matches calls and never definitions.
        const call = new RegExp(`\\b${maker}\\(\\{`, 'g')
        for (const match of source.matchAll(call)) {
          const args = callArguments(source, match.index! + match[0].length - 1)
          if (!/\bprovider\b/.test(args)) silent.push(`${where} → ${maker}`)
        }
      }
    }

    expect(silent).toEqual([])
  })

  /** The exemption is a decision, so it has to stay a small and named one. */
  it('has exactly one exception, and it is the adopted transcript', () => {
    expect(Object.keys(EXEMPT)).toEqual(['api/transcripts/adopt.post.ts'])
  })
})
