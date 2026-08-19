import { describe, expect, it } from 'vitest'
import { holderVerdict } from '../server/utils/branchHolder'
import type { Session } from '../server/utils/sessions'

/**
 * "fatal: branch X is already checked out at Y" was the end of the road for
 * re-reviewing a pull request or picking one up twice. It should never have
 * been: the branch is in a directory on this machine, and which directory
 * decides what to do — continue that session, take the workspace over, or keep
 * your hands off somebody's checkout.
 *
 * The judgement is pure so these cases can be stated as what they are, which is
 * a decision about whose work a directory holds rather than a fact about git.
 */

const ROOT = '/repo/.worktrees'

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Fix the failing check',
    repoDir: '/repo',
    worktreePath: '/repo/.worktrees/s1',
    branch: 'feature-x',
    baseBranch: 'main',
    baseSha: 'abc',
    status: 'idle',
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

const inside = { path: '/repo/.worktrees/s1', canonical: '/repo/.worktrees/s1' }

describe('holderVerdict', () => {
  it('is free when nothing holds the branch', () => {
    expect(holderVerdict({ worktreeRoot: ROOT, holder: null, session: null })).toEqual({ kind: 'free' })
  })

  it('continues the idle session that already has it, rather than making a second', () => {
    const existing = session()
    expect(holderVerdict({ worktreeRoot: ROOT, holder: inside, session: existing }))
      .toEqual({ kind: 'session', session: existing })
  })

  it('will not send work into a session that is mid-turn', () => {
    // Interrupting a running agent with something else is a decision, and it
    // belongs to the person rather than to a click on a pull request row.
    const busy = session({ status: 'running' })
    expect(holderVerdict({ worktreeRoot: ROOT, holder: inside, session: busy }))
      .toEqual({ kind: 'busy', session: busy })
  })

  it('takes back a directory an archived session claims, since archiving removed its worktree', () => {
    // Archiving removes the worktree and keeps the record. A record that still
    // claims a directory git says exists has been overtaken by the filesystem.
    expect(holderVerdict({ worktreeRoot: ROOT, holder: inside, session: session({ status: 'archived' }) }))
      .toEqual({ kind: 'adoptable', path: inside.path })
  })

  it('adopts one of our directories that no session claims', () => {
    // A record deleted from under a worktree, or a crash between the two writes.
    expect(holderVerdict({ worktreeRoot: ROOT, holder: inside, session: null }))
      .toEqual({ kind: 'adoptable', path: inside.path })
  })

  it('refuses to touch your own checkout', () => {
    // The repository itself, with the branch out in it — quite possibly with
    // uncommitted work. Nothing here may switch that away for you.
    const own = { path: '/repo', canonical: '/repo' }
    expect(holderVerdict({ worktreeRoot: ROOT, holder: own, session: null }))
      .toEqual({ kind: 'foreign', path: '/repo' })
  })

  it('refuses a worktree somebody else set up elsewhere', () => {
    const elsewhere = { path: '/somewhere/else', canonical: '/somewhere/else' }
    expect(holderVerdict({ worktreeRoot: ROOT, holder: elsewhere, session: null }))
      .toEqual({ kind: 'foreign', path: '/somewhere/else' })
  })

  it('does not mistake a sibling directory for one of ours', () => {
    // `looksLikeSessionWorktree` compares on a separator-terminated root for
    // exactly this: `.worktrees-old` is not inside `.worktrees`.
    const sibling = { path: '/repo/.worktrees-old/s1', canonical: '/repo/.worktrees-old/s1' }
    expect(holderVerdict({ worktreeRoot: ROOT, holder: sibling, session: null }).kind).toBe('foreign')
  })
})
