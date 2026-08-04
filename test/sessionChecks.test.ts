import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

let claudeDir: string
let repoDir: string
let checks: typeof import('../server/utils/checks')
let sessions: typeof import('../server/utils/sessions')
let sessionChecks: typeof import('../server/utils/sessionChecks')
let merge: typeof import('../server/utils/merge')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
}

/**
 * What a rejected merge actually said. `createError` carries the explanation
 * in `data.message` — the top-level `message` is empty, which is why asserting
 * on it silently passes for the wrong reason.
 */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e: any) {
    return e?.data?.message ?? e?.message ?? ''
  }
  throw new Error('Expected that to be refused, and it was not.')
}

/**
 * A real repository with a real worktree, because the whole point of this
 * feature is that the checks run somewhere other than where you are standing.
 * Faking the worktree would test nothing that matters.
 */
beforeAll(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-checks-cfg-'))
  process.env.CLAUDE_DIR = claudeDir

  repoDir = await mkdtemp(join(tmpdir(), 'agents-ui-checks-repo-'))
  git(repoDir, 'init', '-q', '-b', 'main')
  git(repoDir, 'config', 'user.email', 'test@example.com')
  git(repoDir, 'config', 'user.name', 'Test')
  await writeFile(join(repoDir, 'value.txt'), 'good\n')
  // The project's idea of "does this work": the file must say `good`.
  await writeFile(join(repoDir, 'Makefile'), 'check:\n\tgrep -q good value.txt\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-q', '-m', 'initial')

  // What startSession does before making a worktree. Without it the worktrees
  // show up as untracked content and every merge is blocked on a dirty repo —
  // which is exactly the bug this line exists to prevent.
  await writeFile(join(repoDir, '.git', 'info', 'exclude'), '.worktrees/\n')

  checks = await import('../server/utils/checks')
  sessions = await import('../server/utils/sessions')
  sessionChecks = await import('../server/utils/sessionChecks')
  merge = await import('../server/utils/merge')
})

afterAll(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repoDir, { recursive: true, force: true })
})

/** A session on its own branch and worktree, exactly as startSession makes one. */
async function session(name: string, edit: string) {
  const worktreePath = join(repoDir, '.worktrees', name)
  git(repoDir, 'worktree', 'add', '-q', '-b', name, worktreePath, 'main')
  await writeFile(join(worktreePath, 'value.txt'), edit)
  git(worktreePath, 'add', '-A')
  git(worktreePath, 'commit', '-q', '-m', `change from ${name}`)

  return sessions.saveSession({
    id: name,
    title: name,
    repoDir,
    worktreePath,
    branch: name,
    baseBranch: 'main',
    baseSha: git(repoDir, 'rev-parse', 'main'),
    status: 'idle',
    runIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
}

describe('verifySession', () => {
  it('detects the project\'s own check command without being told', async () => {
    expect((await checks.checkCommandFor(repoDir))?.command).toBe('make check')
  })

  it('records a pass for work that holds up', async () => {
    await session('keeps-working', 'good enough\n')
    const check = await sessionChecks.verifySession('keeps-working')

    expect(check?.status).toBe('passing')
    expect(check?.command).toBe('make check')
    // Kept on the session, so the list can show it without re-running anything.
    expect((await sessions.findSession('keeps-working'))?.check?.status).toBe('passing')
  })

  it('records a failure for work that does not', async () => {
    await session('breaks-it', 'bad\n')
    const check = await sessionChecks.verifySession('breaks-it')

    expect(check?.status).toBe('failing')
    // make reports 2 when a recipe fails, grep reports 1 — what matters is
    // that it is a verdict, not which tool produced it.
    expect(check?.exitCode).toBeGreaterThan(0)
  })

  it('runs in the session\'s workspace, not in the repository', async () => {
    // `breaks-it` failed; the repository itself is untouched and still passes.
    const outcome = await checks.runCheck({ command: 'make check', cwd: repoDir })
    expect(outcome.status).toBe('passing')
  })

  it('says nothing when the project has turned its checks off', async () => {
    await checks.setCheckCommand(repoDir, '')
    await session('no-checks-here', 'anything\n')

    expect(await sessionChecks.verifySession('no-checks-here')).toBeNull()
    expect((await sessions.findSession('no-checks-here'))?.check).toBeUndefined()

    await checks.clearCheckCommand(repoDir)
  })
})

describe('previewMerge with checks', () => {
  it('blocks a merge whose checks failed, and says it can be overruled', async () => {
    const failing = await sessions.findSession('breaks-it')
    const preview = await merge.previewMerge(failing!)

    expect(preview.canMerge).toBe(false)
    expect(preview.blockedByChecks).toBe(true)
    expect(preview.blockedReason).toContain('make check')
    expect(preview.check?.status).toBe('failing')
  })

  it('allows a merge whose checks passed', async () => {
    const passing = await sessions.findSession('keeps-working')
    const preview = await merge.previewMerge(passing!)

    expect(preview.canMerge).toBe(true)
    expect(preview.blockedByChecks).toBeFalsy()
  })

  it('refuses to merge a failing session without an override', async () => {
    const failing = await sessions.findSession('breaks-it')
    expect(await rejection(merge.mergeSession(failing!))).toContain('make check')
  })

  it('merges a failing session when told to, and records that in history', async () => {
    const failing = await sessions.findSession('breaks-it')
    const result = await merge.mergeSession(failing!, { override: true })

    expect(result.merged).toBe(true)
    expect(result.overrodeChecks).toBe(true)
    // The decision outlives whoever remembers making it.
    expect(git(repoDir, 'log', '-1', '--format=%B')).toContain('Merged with `make check` failing')

    git(repoDir, 'reset', '-q', '--hard', 'HEAD~1')
  })

  it('never lets an override past anything git objects to', async () => {
    // A conflict is not a judgement call, so `blockedByChecks` stays false and
    // the override has nothing to apply to.
    const conflicting = await session('conflicts-with-main', 'theirs\n')
    git(repoDir, 'checkout', '-q', 'main')
    await writeFile(join(repoDir, 'value.txt'), 'good ours\n')
    git(repoDir, 'commit', '-qam', 'diverge on main')

    const preview = await merge.previewMerge(conflicting)
    expect(preview.conflicts.length).toBeGreaterThan(0)
    expect(preview.blockedByChecks).toBeFalsy()

    expect(await rejection(merge.mergeSession(conflicting, { override: true })))
      .toMatch(/conflict/i)
  })
})

describe('staleness', () => {
  it('notices when the workspace has moved on since the verdict', async () => {
    const before = await sessions.findSession('keeps-working')
    expect(checks.isStale(before!.check, await checks.worktreeFingerprint(before!.worktreePath))).toBe(false)

    await writeFile(join(before!.worktreePath, 'value.txt'), 'edited after the check\n')

    const after = await checks.worktreeFingerprint(before!.worktreePath)
    expect(checks.isStale(before!.check, after)).toBe(true)
  })

  it('notices an edit that changes no filenames', async () => {
    // Two edits to the same already-modified file leave `git status` identical,
    // so a fingerprint built from filenames alone would miss this entirely.
    const s = await sessions.findSession('keeps-working')
    const first = await checks.worktreeFingerprint(s!.worktreePath)

    await writeFile(join(s!.worktreePath, 'value.txt'), 'edited again, differently\n')
    const second = await checks.worktreeFingerprint(s!.worktreePath)

    expect(second).not.toBe(first)
  })
})
