import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectCheckCommand,
  detectPackageManager,
  isStale,
  looksUnrunnable,
  makefileHasTarget,
  runCheck,
  type SessionCheck,
} from '../server/utils/checks'

const made: string[] = []

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'checks-'))
  made.push(dir)
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents)
  }
  return dir
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

describe('makefileHasTarget', () => {
  it('finds a target at the start of a line', () => {
    expect(makefileHasTarget('check:\n\tbun test\n', 'check')).toBe(true)
  })

  it('does not mistake a variable assignment for a target', () => {
    // `check := ...` defines a variable; running `make check` would fail.
    expect(makefileHasTarget('check := something\n', 'check')).toBe(false)
  })

  it('does not match a target whose name merely contains it', () => {
    expect(makefileHasTarget('precheck:\n\ttrue\n', 'check')).toBe(false)
  })

  it('finds a target that is not the first line', () => {
    expect(makefileHasTarget('dev:\n\tbun dev\n\ncheck:\n\tbun test\n', 'check')).toBe(true)
  })
})

describe('detectPackageManager', () => {
  it('reads the lockfile rather than what is installed', () => {
    expect(detectPackageManager(repo({ 'bun.lockb': '' }))).toBe('bun')
    expect(detectPackageManager(repo({ 'pnpm-lock.yaml': '' }))).toBe('pnpm')
    expect(detectPackageManager(repo({ 'yarn.lock': '' }))).toBe('yarn')
  })

  it('falls back to npm when nothing says otherwise', () => {
    expect(detectPackageManager(repo({}))).toBe('npm')
  })
})

describe('detectCheckCommand', () => {
  it('prefers a check target, which is someone having decided what "alright" means', () => {
    const dir = repo({
      Makefile: 'check:\n\tbun test\n',
      'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    })
    expect(detectCheckCommand(dir)?.command).toBe('make check')
  })

  it('prefers a check script over a bare test script', () => {
    const dir = repo({
      'package.json': JSON.stringify({ scripts: { check: 'vitest && tsc', test: 'vitest' } }),
    })
    expect(detectCheckCommand(dir)?.command).toBe('npm run check')
  })

  it('uses the project\'s own package manager', () => {
    const dir = repo({
      'bun.lockb': '',
      'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    })
    expect(detectCheckCommand(dir)?.command).toBe('bun run test')
  })

  it('falls back to a test target before a test script', () => {
    const dir = repo({
      Makefile: 'test:\n\tbun test\n',
      'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
    })
    expect(detectCheckCommand(dir)?.command).toBe('make test')
  })

  it('recognises projects that are not JavaScript', () => {
    expect(detectCheckCommand(repo({ 'Cargo.toml': '' }))?.command).toBe('cargo test')
    expect(detectCheckCommand(repo({ 'go.mod': '' }))?.command).toBe('go test ./...')
    expect(detectCheckCommand(repo({ 'pyproject.toml': '' }))?.command).toBe('pytest')
  })

  it('says so rather than guessing when there is nothing to go on', () => {
    expect(detectCheckCommand(repo({ 'README.md': '# hi' }))).toBeNull()
  })

  it('survives a package.json that will not parse', () => {
    // A broken manifest is a reason to have no guess, not to throw.
    expect(detectCheckCommand(repo({ 'package.json': '{ not json' }))).toBeNull()
  })

  it('explains where the guess came from', () => {
    const dir = repo({ Makefile: 'check:\n\ttrue\n' })
    expect(detectCheckCommand(dir)?.from).toContain('Makefile')
  })
})

describe('looksUnrunnable', () => {
  it('treats a missing command as no verdict', () => {
    expect(looksUnrunnable(127, 'sh: make: command not found')).toBe(true)
    expect(looksUnrunnable(1, 'sh: vitest: command not found')).toBe(true)
  })

  it('treats missing dependencies as no verdict', () => {
    // A worktree without its dependencies is not a broken change.
    expect(looksUnrunnable(1, "Error: Cannot find module 'vitest'")).toBe(true)
  })

  it('leaves a real test failure alone', () => {
    expect(looksUnrunnable(1, '2 tests failed\n  expected 3 to be 4')).toBe(false)
  })
})

describe('runCheck', () => {
  it('reports a passing command', async () => {
    const outcome = await runCheck({ command: 'echo fine', cwd: repo({}) })
    expect(outcome.status).toBe('passing')
    expect(outcome.exitCode).toBe(0)
    expect(outcome.output).toContain('fine')
  })

  it('reports a failing command as a verdict about the code', async () => {
    const outcome = await runCheck({ command: 'echo nope >&2; exit 1', cwd: repo({}) })
    expect(outcome.status).toBe('failing')
    expect(outcome.exitCode).toBe(1)
    expect(outcome.output).toContain('nope')
  })

  it('reports a command that does not exist as having no verdict', async () => {
    const outcome = await runCheck({ command: 'definitely-not-a-real-command', cwd: repo({}) })
    expect(outcome.status).toBe('errored')
  })

  it('runs through a shell, so chained commands work', async () => {
    const outcome = await runCheck({ command: 'true && echo both', cwd: repo({}) })
    expect(outcome.status).toBe('passing')
    expect(outcome.output).toContain('both')
  })

  it('does not blame the code for a workspace that is gone', async () => {
    const outcome = await runCheck({ command: 'true', cwd: '/nowhere/at/all' })
    expect(outcome.status).toBe('errored')
    expect(outcome.output).toContain('not on disk')
  })

  it('stops a command that never finishes, without a verdict', async () => {
    const outcome = await runCheck({ command: 'sleep 30', cwd: repo({}), timeoutMs: 300 })
    expect(outcome.status).toBe('errored')
    expect(outcome.output).toContain('no verdict')
  })
})

describe('isStale', () => {
  const check = (over: Partial<SessionCheck> = {}): SessionCheck => ({
    status: 'passing',
    command: 'make check',
    fingerprint: 'abc',
    exitCode: 0,
    output: '',
    durationMs: 10,
    at: 0,
    ...over,
  })

  it('is stale once the workspace has moved on', () => {
    expect(isStale(check(), 'def')).toBe(true)
  })

  it('is not stale while the workspace matches', () => {
    expect(isStale(check(), 'abc')).toBe(false)
  })

  it('says nothing about a check that has never run', () => {
    expect(isStale(undefined, 'abc')).toBe(false)
  })

  it('does not call a check in progress stale', () => {
    // It has no fingerprint yet — it is being run against the current state.
    expect(isStale(check({ status: 'running', fingerprint: '' }), 'abc')).toBe(false)
  })

  it('does not claim staleness when the workspace cannot be read', () => {
    expect(isStale(check(), '')).toBe(false)
  })
})
