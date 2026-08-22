import { describe, expect, it } from 'vitest'
import {
  collectLessons,
  LESSON_THRESHOLD,
  type LessonInput,
  type LessonRun,
  type LessonSession,
} from '../server/utils/lessons'

/**
 * The list you are supposed to be able to disagree with.
 *
 * Which means the interesting tests are not "does it find the thing" — that part
 * is a loop over records. They are the four ways a collector like this becomes
 * useless: it repeats itself, it counts noise as a pattern, it blames a merge for
 * code that was already broken, and it keeps telling you about something that
 * stopped happening a month ago.
 */

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function input(over: Partial<LessonInput> = {}): LessonInput {
  return { now: NOW, sessions: [], runs: [], checks: {}, ...over }
}

function reverted(id: string, at: number, over: Partial<LessonSession> = {}): LessonSession {
  return {
    id,
    title: id,
    repoDir: '/w/app',
    landed: { at: at - 3_600_000 },
    reverted: { at, committedAt: at, subject: `Revert "${id}"` },
    ...over,
  }
}

function run(id: string, at: number, over: Partial<LessonRun> = {}): LessonRun {
  return { id, at, ...over }
}

describe('work that was taken back out', () => {
  it('is a lesson on its own, because a revert is already somebody deciding', () => {
    const [lesson, ...rest] = collectLessons(input({ sessions: [reverted('s1', NOW - DAY)] }))

    expect(rest).toEqual([])
    expect(lesson).toMatchObject({ kind: 'reverted', count: 1, repoDir: '/w/app' })
    expect(lesson!.sessions).toEqual([{ id: 's1', title: 's1' }])
    expect(lesson!.subjects).toEqual(['Revert "s1"'])
    expect(LESSON_THRESHOLD.reverted).toBe(1)
  })

  it('is one lesson about the repository, not three unrelated accidents', () => {
    const lessons = collectLessons(input({
      sessions: [reverted('s1', NOW - DAY), reverted('s2', NOW - 2 * DAY), reverted('s3', NOW - 3 * DAY)],
    }))

    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toMatchObject({ count: 3, lastAt: NOW - DAY, firstAt: NOW - 3 * DAY })
    expect(lessons[0]!.sessions.map(s => s.id).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('keeps two repositories apart, because the lesson is about the repository', () => {
    const lessons = collectLessons(input({
      sessions: [reverted('s1', NOW - DAY), reverted('s2', NOW - DAY, { repoDir: '/w/other' })],
    }))

    expect(lessons.map(l => l.repoDir).sort()).toEqual(['/w/app', '/w/other'])
  })

  it('ignores a landing that was never reverted, and a revert with no landing', () => {
    const lessons = collectLessons(input({
      sessions: [
        { id: 'landed', title: 'landed', repoDir: '/w/app', landed: { at: NOW - DAY } },
        { id: 'odd', title: 'odd', repoDir: '/w/app', reverted: { at: NOW - DAY } },
      ],
    }))

    expect(lessons).toEqual([])
  })

  it('dates it by when the revert was committed, not when this machine noticed', () => {
    // A laptop shut for two days must not make a fortnight-old revert read as
    // today's news.
    const noticedLate = reverted('s1', NOW - 14 * DAY)
    noticedLate.reverted!.at = NOW

    const [lesson] = collectLessons(input({ sessions: [noticedLate] }))

    expect(lesson!.lastAt).toBe(NOW - 14 * DAY)
  })
})

describe('a check that went red after a landing', () => {
  const landing = { id: 's1', title: 'The merge', repoDir: '/w/app', landed: { at: NOW - 2 * DAY } }

  it('needs to happen more than once to be a pattern', () => {
    const once = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 3 * DAY, passed: true, failed: [] },
          { at: NOW - 2 * DAY + 3_600_000, passed: false, failed: ['vitest'] },
        ],
      },
    }))

    expect(once).toEqual([])
    expect(LESSON_THRESHOLD['base-broken']).toBe(2)
  })

  it('is a lesson once the same check goes red twice inside the day', () => {
    const lessons = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 3 * DAY, passed: true, failed: [] },
          { at: NOW - 2 * DAY + 3_600_000, passed: false, failed: ['vitest'] },
          { at: NOW - 2 * DAY + 7_200_000, passed: false, failed: ['vitest'] },
        ],
      },
    }))

    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toMatchObject({ kind: 'base-broken', count: 2, repoDir: '/w/app' })
    expect(lessons[0]!.subjects).toEqual(['vitest'])
  })

  it('does not blame the merge for a check that was already red', () => {
    const lessons = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 4 * DAY, passed: true, failed: [] },
          // Failing before the landing, so the landing did not do it.
          { at: NOW - 3 * DAY, passed: false, failed: ['vitest'] },
          { at: NOW - 2 * DAY + 3_600_000, passed: false, failed: ['vitest'] },
          { at: NOW - 2 * DAY + 7_200_000, passed: false, failed: ['vitest'] },
        ],
      },
    }))

    expect(lessons).toEqual([])
  })

  it('says nothing about a repository whose checks have never passed here', () => {
    const lessons = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 2 * DAY + 3_600_000, passed: false, failed: ['setup'] },
          { at: NOW - 2 * DAY + 7_200_000, passed: false, failed: ['setup'] },
        ],
      },
    }))

    // The first verdict in a repository must not read as a regression.
    expect(lessons).toEqual([])
  })

  it('stops looking a day after the landing', () => {
    const lessons = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 3 * DAY, passed: true, failed: [] },
          { at: NOW - 2 * DAY + 2 * DAY, passed: false, failed: ['vitest'] },
          { at: NOW - 2 * DAY + 2 * DAY + 60_000, passed: false, failed: ['vitest'] },
        ],
      },
    }))

    expect(lessons).toEqual([])
  })

  it('keeps two checks apart, because the fix is per check', () => {
    const lessons = collectLessons(input({
      sessions: [landing],
      checks: {
        '/w/app': [
          { at: NOW - 3 * DAY, passed: true, failed: [] },
          { at: NOW - 2 * DAY + 3_600_000, passed: false, failed: ['vitest', 'typecheck'] },
          { at: NOW - 2 * DAY + 7_200_000, passed: false, failed: ['vitest', 'typecheck'] },
        ],
      },
    }))

    expect(lessons.map(l => l.subjects[0]).sort()).toEqual(['typecheck', 'vitest'])
  })
})

describe('the same wall, hit over and over', () => {
  it('needs three runs before it is a pattern rather than a Tuesday', () => {
    const twice = collectLessons(input({
      runs: [
        run('r1', NOW - DAY, { deniedTools: ['Bash(gh:*)'] }),
        run('r2', NOW - 2 * DAY, { deniedTools: ['Bash(gh:*)'] }),
      ],
    }))

    expect(twice).toEqual([])
    expect(LESSON_THRESHOLD.denied).toBe(3)
  })

  it('is one lesson with a count, however many runs hit it', () => {
    const lessons = collectLessons(input({
      runs: [1, 2, 3, 4].map(n => run(`r${n}`, NOW - n * 3_600_000, { deniedTools: ['Bash(gh:*)'] })),
    }))

    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toMatchObject({ kind: 'denied', count: 4 })
    expect(lessons[0]!.subjects).toEqual(['Bash(gh:*)'])
  })

  it('keeps a refused host apart from a refused tool, because the fix differs', () => {
    const lessons = collectLessons(input({
      runs: [1, 2, 3].flatMap(n => [
        run(`t${n}`, NOW - n * 3_600_000, { deniedTools: ['registry.npmjs.org'] }),
        run(`h${n}`, NOW - n * 3_600_000, { refusedHosts: ['registry.npmjs.org'] }),
      ]),
    }))

    // Same name, two lessons: one is a permission rule, the other a domain.
    expect(lessons.map(l => l.key).sort()).toEqual([
      'denied:host:registry.npmjs.org', 'denied:tool:registry.npmjs.org',
    ])
  })

  it('counts one run once, however often it lists the same tool', () => {
    const lessons = collectLessons(input({
      runs: [
        run('r1', NOW - 1000, { deniedTools: ['Bash(gh:*)', 'Bash(gh:*)', 'Bash(gh:*)'] }),
        run('r2', NOW - 2000, { deniedTools: ['Bash(gh:*)'] }),
      ],
    }))

    // Two runs, not four: the pattern is runs that hit the wall.
    expect(lessons).toEqual([])
  })

  it('names the sessions it happened in', () => {
    const lessons = collectLessons(input({
      sessions: [{ id: 's1', title: 'Nightly triage' }],
      runs: [1, 2, 3].map(n => run(`r${n}`, NOW - n * 1000, {
        sessionId: 's1', deniedTools: ['Bash(gh:*)'],
      })),
    }))

    expect(lessons[0]!.sessions).toEqual([{ id: 's1', title: 'Nightly triage' }])
  })
})

describe('a signal that stops recurring', () => {
  it('ages out of the list entirely', () => {
    const old = input({
      sessions: [reverted('s1', NOW - 40 * DAY)],
      runs: [1, 2, 3].map(n => run(`r${n}`, NOW - (40 + n) * DAY, { deniedTools: ['Bash(gh:*)'] })),
    })

    expect(collectLessons(old)).toEqual([])
  })

  it('keeps only the occurrences inside the window, so the count decays', () => {
    const lessons = collectLessons(input({
      sessions: [
        reverted('recent', NOW - 2 * DAY),
        reverted('ancient', NOW - 40 * DAY),
      ],
    }))

    expect(lessons[0]).toMatchObject({ count: 1 })
    expect(lessons[0]!.sessions.map(s => s.id)).toEqual(['recent'])
  })

  it('honours a narrower window when asked for one', () => {
    const week = collectLessons(input({
      windowDays: 7,
      sessions: [reverted('s1', NOW - 20 * DAY)],
    }))

    expect(week).toEqual([])
  })
})

describe('the list itself', () => {
  it('puts the most recent lesson first, whatever the counts are', () => {
    const lessons = collectLessons(input({
      sessions: [reverted('s1', NOW - 10 * DAY)],
      runs: [1, 2, 3, 4, 5].map(n => run(`r${n}`, NOW - n * 1000, { deniedTools: ['Bash(gh:*)'] })),
    }))

    // Five denials outnumber one revert and are still second, because a lesson
    // from a fortnight ago is not what to read first.
    expect(lessons.map(l => l.kind)).toEqual(['denied', 'reverted'])
  })

  it('is empty on a machine where nothing has gone wrong', () => {
    expect(collectLessons(input())).toEqual([])
  })

  it('carries no prose anybody has to take on trust', () => {
    const [lesson] = collectLessons(input({ sessions: [reverted('s1', NOW - DAY)] }))

    // Every field is an id, a count, a name or a timestamp — the revert subject
    // is the one string, and it is git's own, not a model's.
    expect(Object.keys(lesson!).sort()).toEqual([
      'count', 'firstAt', 'key', 'kind', 'lastAt', 'repoDir', 'sessions', 'subjects',
    ])
  })
})
