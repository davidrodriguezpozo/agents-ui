import { describe, expect, it } from 'vitest'
import { orphanKind, worthAlarming } from '../app/utils/orphanWorktrees'

/**
 * Telling a lost session from a branch nobody owns.
 *
 * Found on a real machine: twenty worktrees, twelve of them orphaned, and all
 * twelve reported as sessions waiting to be restored. Not one had a transcript.
 * Their branch names were `fix/authorization-gaps` and `refactor/misc-dead-code`
 * — conventional names, not this app's slug-plus-session-id shape — so they were
 * never its sessions at all. The old test was "is the directory still there",
 * which is true of every one of them.
 */

const lostSession = { exists: true, hasConversation: true }
const stray = { exists: true, hasConversation: false }
const gone = { exists: false, hasConversation: false }

describe('orphanKind', () => {
  it('calls a worktree with a conversation restorable', () => {
    expect(orphanKind(lostSession)).toBe('restorable')
  })

  it('calls a worktree with only a branch a stray', () => {
    // The twelve. Real commits, real branch, no conversation to resume.
    expect(orphanKind(stray)).toBe('stray')
  })

  it('offers nothing for a worktree whose directory has gone', () => {
    expect(orphanKind(gone)).toBe('gone')
  })

  it('treats a missing recovery record as nothing to offer', () => {
    // The API hands back `null` here and a caller may hold `undefined`; both
    // mean the same nothing, and neither should read as restorable.
    expect(orphanKind(undefined)).toBe('gone')
    expect(orphanKind(null)).toBe('gone')
  })

  it('never calls something restorable on the strength of the directory alone', () => {
    // The whole bug in one line: `exists` is a fact about the filesystem.
    expect(orphanKind({ exists: true, hasConversation: false })).not.toBe('restorable')
  })
})

describe('worthAlarming', () => {
  it('forces the panel open for a lost conversation', () => {
    // The case this alarm exists for: a crash or a damaged index leaves a
    // conversation on disk with nothing pointing at it, and deleting it is the
    // one action here that cannot be undone.
    expect(worthAlarming([stray, lostSession, gone])).toBe(true)
  })

  it('stays quiet for strays, however many there are', () => {
    // Twelve of them, every load, was an alarm that taught the reader to ignore
    // the panel — which costs the real case above.
    expect(worthAlarming(Array.from({ length: 12 }, () => stray))).toBe(false)
  })

  it('stays quiet when there is nothing at all', () => {
    expect(worthAlarming([])).toBe(false)
    expect(worthAlarming([undefined])).toBe(false)
    expect(worthAlarming([null])).toBe(false)
  })
})
