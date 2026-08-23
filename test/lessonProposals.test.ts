import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A rule that learns, as a diff.
 *
 * The whole argument for this feature is that it is auditable, so the tests are
 * about the audit rather than about the model: the line that was shown is the
 * line that gets written, the file it lands in is named before anything happens,
 * a rejection is remembered, and nothing anywhere writes without a decision.
 *
 * The model is injected. It is one line from six numbers and its wording is not
 * something a test can usefully assert — what a test *can* assert is that the
 * prompt it receives contains nothing from outside this machine.
 */

let repo: string
let claudeDir: string
let proposals: typeof import('../server/utils/lessonProposals')

const candidate = {
  key: 'denied:host:api.example.org',
  kind: 'denied' as const,
  count: 5,
  lastAt: 1_700_000_000_000,
  firstAt: 1_699_000_000_000,
  repoDir: '/w/webapp',
  subjects: ['api.example.org'],
  sessions: [{ id: 's1', title: 'A session title nobody outside should see' }],
}

/** A writer that records what it was asked and answers with a fixed line. */
function writer(line = 'Allow api.example.org in the sandbox for this project before running installs.') {
  const prompts: string[] = []
  return { prompts, write: async (prompt: string) => { prompts.push(prompt); return line } }
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-proposals-cfg-'))
  process.env.CLAUDE_DIR = claudeDir
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-proposals-repo-'))

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)
  proposals = await import('../server/utils/lessonProposals')
})

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

function into(destination: 'claude-md' | 'brief' | 'shared-project') {
  return proposals.destinationsFor(repo).find(d => d.destination === destination)!
}

describe('what the model is told', () => {
  it('sees the counted facts and nothing a colleague wrote', async () => {
    const w = writer()
    await proposals.proposeLine(candidate, into('claude-md'), w.write)

    const prompt = w.prompts[0]!

    expect(prompt).toContain('api.example.org')
    expect(prompt).toContain('"happened": 5')
    // The session title is in the candidate and must not reach the prompt: it is
    // the one field in a lesson that came from outside this machine.
    expect(prompt).not.toContain('nobody outside should see')
    expect(prompt).not.toContain('s1')
  })

  it('names the repository by name and never by path', async () => {
    const w = writer()
    await proposals.proposeLine(candidate, into('claude-md'), w.write)

    expect(w.prompts[0]).toContain('"repository": "webapp"')
    expect(w.prompts[0]).not.toContain('/w/webapp')
  })

  it('names the repository even when the lesson came from a worktree', async () => {
    // A session's run names its worktree, whose last segment is a generated id.
    // The first real proposal was told it was about a repository called
    // `mt2z09ee5lmu`, which is a session.
    const w = writer()
    await proposals.proposeLine(
      { ...candidate, repoDir: '/w/webapp/.worktrees/mt2z09ee5lmu' },
      into('claude-md'),
      w.write,
    )

    expect(w.prompts[0]).toContain('"repository": "webapp"')
    expect(w.prompts[0]).not.toContain('mt2z09ee5lmu')
  })

  it('says what the signal actually means, so a rule is not written about the wrong party', async () => {
    const w = writer()
    await proposals.proposeLine(candidate, into('claude-md'), w.write)

    // Without this the model guesses, and it guesses plausibly wrong: the first
    // real line blamed the remote host for refusing when it was our own sandbox.
    expect(w.prompts[0]).toContain('The remote side never refused anything')
  })

  it('asks for a different kind of line per destination', async () => {
    const forRepo = writer()
    const forMachine = writer()
    await proposals.proposeLine(candidate, into('claude-md'), forRepo.write)
    await proposals.proposeLine(candidate, into('brief'), forMachine.write)

    expect(forRepo.prompts[0]).toContain('whoever works in this repository next')
    expect(forMachine.prompts[0]).toContain('nobody else will read')
  })
})

describe('the line that comes back', () => {
  it('is stripped of the things a small model adds', () => {
    // Bold survives: a bullet is a marker and a space, not any run of asterisks.
    expect(proposals.cleanLine('Rule: **do the thing**')).toBe('**do the thing**')
    expect(proposals.cleanLine('- "Allow the host first."')).toBe('Allow the host first.')
    expect(proposals.cleanLine('  Allow it.\nAnd another thing')).toBe('Allow it.')
  })

  it('is empty when the model declines, and then there is no diff', async () => {
    const { line, diff } = await proposals.proposeLine(candidate, into('claude-md'), async () => 'NOTHING')

    expect(line).toBe('')
    expect(diff).toBe('')
  })

  it('is clipped rather than allowed to become a paragraph', () => {
    const long = proposals.cleanLine('x'.repeat(400))

    expect(long.length).toBeLessThanOrEqual(proposals.MAX_LINE)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('the diff', () => {
  it('shows the last lines of the file and the one being added', async () => {
    await writeFile(join(repo, 'CLAUDE.md'), '# Rules\n\nOne.\nTwo.\nThree.\n', 'utf8')

    const { diff } = await proposals.proposeLine(candidate, into('claude-md'), writer('Four.').write)

    expect(diff).toContain(join(repo, 'CLAUDE.md'))
    expect(diff).toContain(' Two.')
    expect(diff).toContain(' Three.')
    expect(diff).toContain('+Four.')
  })

  it('says out loud when accepting would create the file', async () => {
    const { diff, creates } = await proposals.proposeLine(candidate, into('claude-md'), writer('First rule.').write)

    expect(creates).toBe(true)
    expect(diff).toContain('does not exist yet')
    expect(diff).toContain('+First rule.')
  })
})

describe('accepting', () => {
  it('writes exactly the line that was shown, and says which file changed', async () => {
    await writeFile(join(repo, 'CLAUDE.md'), '# Rules\n\nOne.\n', 'utf8')
    const proposal = await proposals.proposeLine(candidate, into('claude-md'), writer('Two.').write)

    const result = await proposals.acceptProposal(proposal)

    expect(result.ok).toBe(true)
    expect(result.path).toBe(join(repo, 'CLAUDE.md'))
    expect(await readFile(join(repo, 'CLAUDE.md'), 'utf8')).toBe('# Rules\n\nOne.\nTwo.\n')
    expect(result.message).toContain('commit it to share it')
  })

  it('creates a destination file that does not exist', async () => {
    const proposal = await proposals.proposeLine(candidate, into('claude-md'), writer('First rule.').write)

    const result = await proposals.acceptProposal(proposal)

    expect(result).toMatchObject({ ok: true, created: true })
    expect(await readFile(join(repo, 'CLAUDE.md'), 'utf8')).toBe('First rule.\n')
    expect(result.message).toContain('new file in your working tree')
  })

  it('appends rather than reordering what is already there', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, 'CLAUDE.md'), 'B\nA\nC', 'utf8')

    await proposals.acceptProposal(
      await proposals.proposeLine(candidate, into('claude-md'), writer('D').write),
    )

    // Order untouched, and the missing trailing newline added rather than two
    // lines run together.
    expect(await readFile(join(repo, 'CLAUDE.md'), 'utf8')).toBe('B\nA\nC\nD\n')
  })

  it('puts a machine-only line in the standing brief instead of a file', async () => {
    const proposal = await proposals.proposeLine(candidate, into('brief'), writer('Watch that host.').write)

    const result = await proposals.acceptProposal(proposal)
    const { briefStore } = await import('../server/utils/brief')

    expect(result.ok).toBe(true)
    expect((await briefStore.read()).pinned).toContain('Watch that host.')
  })

  it('refuses a proposal with no line in it', async () => {
    const empty = await proposals.proposeLine(candidate, into('claude-md'), async () => 'NOTHING')

    expect(await proposals.acceptProposal(empty)).toMatchObject({ ok: false })
  })

  it('records what was agreed, and where', async () => {
    await proposals.acceptProposal(
      await proposals.proposeLine(candidate, into('claude-md'), writer('Allow the host.').write),
    )

    const decisions = await proposals.readLessonDecisions()

    expect(decisions[candidate.key]).toMatchObject({
      verdict: 'accepted',
      destination: 'claude-md',
      line: 'Allow the host.',
    })
  })
})

describe('rejecting', () => {
  it('is remembered', async () => {
    await proposals.rejectLesson(candidate.key)

    expect((await proposals.readLessonDecisions())[candidate.key]).toMatchObject({ verdict: 'rejected' })
  })

  it('keeps the same lesson out of next week list', async () => {
    const decisions = { [candidate.key]: { key: candidate.key, verdict: 'rejected' as const, at: 1 } }

    // The signal is still there — the collector will find it again every week —
    // and a list that reopens with it is a list that stops being read.
    expect(proposals.undecidedLessons([candidate], decisions)).toEqual([])
  })

  it('keeps an accepted lesson out too, because its rule is already in a file', () => {
    const decisions = { [candidate.key]: { key: candidate.key, verdict: 'accepted' as const, at: 1 } }

    expect(proposals.undecidedLessons([candidate], decisions)).toEqual([])
  })

  it('leaves a lesson nobody has ruled on in the list', () => {
    expect(proposals.undecidedLessons([candidate], {})).toEqual([candidate])
  })

  it('treats an unreadable record as nothing decided rather than as everything decided', async () => {
    await mkdir(join(claudeDir, 'agents-ui'), { recursive: true })
    await writeFile(join(claudeDir, 'agents-ui', 'lesson-decisions.json'), '{ broken', 'utf8')

    // The noisy failure, not the silent one: a lesson shown again is a nuisance,
    // a lesson hidden is the feature not working.
    expect(await proposals.readLessonDecisions()).toEqual({})
  })
})

describe('the destinations', () => {
  it('say which file each one is, and whether it exists yet', async () => {
    await writeFile(join(repo, 'CLAUDE.md'), '# Rules\n', 'utf8')

    const found = proposals.destinationsFor(repo)

    expect(found.map(d => d.destination)).toEqual(['claude-md', 'brief', 'shared-project'])
    expect(found[0]).toMatchObject({ path: join(repo, 'CLAUDE.md'), exists: true, creates: false })
    expect(found[2]).toMatchObject({ creates: true })
  })
})
