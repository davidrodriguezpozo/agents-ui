import { describe, expect, it } from 'vitest'
import {
  commentBody,
  includeByDefault,
  parseLocation,
  parseReviewReport,
  suggestedEvent,
} from '../server/utils/reviewReport'

/**
 * Getting a review back out of the report a review command wrote.
 *
 * The tests are mostly about the two ways this could do real damage: inventing
 * a finding the review did not make, and posting a comment that says less than
 * the review said. Everything else is shape.
 */

/** The full-review template from `pr-doctor`, with the sections a real one has. */
const FULL = `
▸ phase 5/6: conventions, architecture, a11y & repo fit
▸ phase 6/6: synthesis & self-skepticism

# PR review — feat/rate-limit-ingest

## Open comments (1 total)

### Review threads
- [ana] \`packages/server/src/ingest.ts:88\` — "can we pull the constant out?" — OPEN

## Scope
- Base: master   Commits: 3   Files: 4   +180/-12
- Packages touched: server, web-app

## Feature model
- What this PR claims to do: rate limit the ingest endpoint

## Findings
| Location | Severity | Category | Issue | Suggested fix |
|----------|----------|----------|-------|---------------|
| \`packages/server/src/ingest.ts:214\` | \`[BLOCKING]\` | \`logic\` | Window resets every request | Move the assignment below the comparison |
| \`packages/server/src/ingest.ts:230\` | \`[WARN]\` | \`convention\` | Magic number 60_000 | Extract a named constant |
| \`packages/web-app/src/Banner.tsx:12\` | \`[OK]\` | \`style\` | Stray import | Drop it |

## Detailed findings

### \`[BLOCKING]\` \`packages/server/src/ingest.ts:214\` — the limit never triggers, so the endpoint is unprotected
\`windowStart\` is reassigned on line 212, before the comparison on 214, so the
elapsed window is always zero.

Scenario: 500 requests in one second from one tenant all pass.

Fix: move the assignment below the comparison.

\`\`\`ts
if (now - windowStart > WINDOW_MS) windowStart = now
\`\`\`

Test: a test firing three requests inside the window should see the third refused.

### \`[WARN]\` \`packages/server/src/ingest.ts:230\` — is 60_000 the window or the timeout?
Two different meanings are spelled the same way here.

## Commit message check
- 3f9ac21 feat: rate limit ingest — OK

## Summary
Solid apart from the window reset, which is a real bug and blocks this.

## Next step
Address the \`[BLOCKING]\` finding at ingest.ts:214, then re-run \`/hd:review\`.
`

describe('parseReviewReport', () => {
  it('reads the findings table past the narration and the title', () => {
    const report = parseReviewReport(FULL)!
    expect(report.title).toBe('feat/rate-limit-ingest')
    expect(report.findings).toHaveLength(3)
    expect(report.findings[0]).toMatchObject({
      path: 'packages/server/src/ingest.ts',
      line: 214,
      severity: 'BLOCKING',
      category: 'logic',
    })
  })

  /**
   * The reason this is a parser and not a model: the detailed block is the
   * finding written properly, and it is what gets posted. Re-writing it would
   * have thrown away the scenario and the named regression test.
   */
  it('posts the detailed block, not the table cell', () => {
    const report = parseReviewReport(FULL)!
    const body = commentBody(report.findings[0]!)
    expect(body).toContain('reassigned on line 212')
    expect(body).toContain('500 requests in one second')
    expect(body).toContain('should see the third refused')
  })

  it('offers the fenced block as a suggestion and nothing else as one', () => {
    const report = parseReviewReport(FULL)!
    expect(report.findings[0]!.suggestion).toBe('if (now - windowStart > WINDOW_MS) windowStart = now')
    // Prose in a suggestion block is a diff the author cannot commit.
    expect(report.findings[1]!.suggestion).toBeUndefined()
  })

  it('keeps other people\'s open threads apart from your findings', () => {
    const report = parseReviewReport(FULL)!
    expect(report.openComments).toEqual([
      {
        author: 'ana',
        location: 'packages/server/src/ingest.ts:88',
        quote: 'can we pull the constant out?',
      },
    ])
    expect(report.findings.map(f => f.line)).not.toContain(88)
  })

  it('takes the summary as the review body and drops the next step', () => {
    const report = parseReviewReport(FULL)!
    expect(report.summary).toContain('Solid apart from the window reset')
    expect(report.summary).not.toContain('re-run')
  })

  it('keeps the reviewer\'s proof-of-work out of the findings', () => {
    const report = parseReviewReport(FULL)!
    expect(report.context.scope).toContain('Base: master')
    expect(report.context.featureModel).toContain('rate limit the ingest endpoint')
    expect(report.findings.map(f => f.issue).join()).not.toContain('Base: master')
  })

  it('does not flag a well-formed report', () => {
    // The `[OK]` row needs no detailed block — the format says nits stay in the
    // table — so a clean report has nothing to report about itself.
    expect(parseReviewReport(FULL)!.violations).toEqual([])
  })
})

describe('contract violations', () => {
  /**
   * The one thing a format gets you that a model does not. Six rows and three
   * blocks is a report missing half of itself, and the alternative to saying so
   * is posting a five-word table cell as a review comment.
   */
  it('names a blocking finding that has no detailed block', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
| Location | Severity | Category | Issue | Suggested fix |
|---|---|---|---|---|
| \`a.ts:1\` | \`[BLOCKING]\` | \`logic\` | it breaks | fix it |
`)!
    expect(report.violations.join()).toContain('no detailed block')
  })

  it('names a detailed block with no row in the table', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
| Location | Severity | Category | Issue | Suggested fix |
|---|---|---|---|---|
| \`a.ts:1\` | \`[WARN]\` | \`logic\` | small | fix |

## Detailed findings

### \`[WARN]\` \`a.ts:1\` — small
because

### \`[BLOCKING]\` \`b.ts:9\` — never made it to the table
mechanism
`)!
    expect(report.violations.join()).toContain('no row in the findings table')
    // Kept anyway: the detailed section is the more reliable of the two.
    expect(report.findings.map(f => f.path)).toContain('b.ts')
  })

  it('names a location that cannot be posted inline', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
| Location | Severity | Category | Issue | Suggested fix |
|---|---|---|---|---|
| the whole migration | \`[WARN]\` | \`logic\` | ordering | reorder |
`)!
    expect(report.findings[0]!.path).toBeUndefined()
    expect(report.violations.join()).toContain('cannot be posted inline')
  })
})

describe('the bullet form', () => {
  /**
   * Which shape a report uses is decided by how many findings it had — under
   * four is a bullet list. A parser that only did tables would produce an empty
   * draft from exactly the reviews that went well.
   */
  it('reads fewer-than-four findings written as bullets', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
- \`auth.ts:42\` — \`[BLOCKING]\` \`logic\` — Missing token validation — Add \`validateToken()\` before the handler
- \`users.ts:120\` — \`[WARN]\` \`cross-file\` — Signature changed — Update the three callers
`)!
    expect(report.findings).toHaveLength(2)
    expect(report.findings[0]).toMatchObject({
      path: 'auth.ts',
      line: 42,
      severity: 'BLOCKING',
      category: 'logic',
      issue: 'Missing token validation',
    })
    expect(report.findings[0]!.fix).toContain('validateToken')
  })

  it('gives an em dash in the issue to the issue, not to the fix', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
- \`a.ts:1\` — \`[WARN]\` \`logic\` — the guard — the one added here — never runs — Invert it
`)!
    expect(report.findings[0]!.issue).toBe('the guard — the one added here — never runs')
    expect(report.findings[0]!.fix).toBe('Invert it')
  })
})

describe('parseLocation', () => {
  it('reads a path and a line', () => {
    expect(parseLocation('`packages/server/src/a.ts:214`')).toEqual({
      path: 'packages/server/src/a.ts',
      line: 214,
    })
  })

  it('keeps the first line of a range', () => {
    expect(parseLocation('a.ts:42-50')).toEqual({ path: 'a.ts', line: 42 })
  })

  it('reads a whole-file location', () => {
    expect(parseLocation('packages/server/src/a.ts')).toEqual({ path: 'packages/server/src/a.ts' })
  })

  /** A trailing colon with no digits is not line zero. */
  it('degrades a truncated location to the whole file', () => {
    expect(parseLocation('a.ts:')).toEqual({ path: 'a.ts' })
  })

  it('refuses a location that is prose', () => {
    expect(parseLocation('the whole migration')).toEqual({})
  })
})

describe('defaults', () => {
  it('checks blockers and warnings, leaves nits alone', () => {
    expect(includeByDefault({ severity: 'BLOCKING' } as any)).toBe(true)
    expect(includeByDefault({ severity: 'WARN' } as any)).toBe(true)
    expect(includeByDefault({ severity: 'OK' } as any)).toBe(false)
    expect(includeByDefault({ severity: 'SKIP' } as any)).toBe(false)
  })

  /** Never approve on a machine's reading of a diff. */
  it('never suggests approving', () => {
    const clean = parseReviewReport('# PR review — x\n\n## Findings\n\n## Verdict\n`[READY]` — nothing found\n')!
    expect(suggestedEvent(clean)).toBe('COMMENT')
  })

  it('requests changes when the report said blocked', () => {
    const blocked = parseReviewReport('# PR review — x\n\n## Findings\n\n## Verdict\n`[BLOCKED]` — see above\n')!
    expect(blocked.verdict).toBe('BLOCKED')
    expect(suggestedEvent(blocked)).toBe('REQUEST_CHANGES')
  })

  it('requests changes on a blocking finding even when the verdict forgot to', () => {
    const report = parseReviewReport(`
# PR review — x

## Findings
| Location | Severity | Category | Issue | Suggested fix |
|---|---|---|---|---|
| \`a.ts:1\` | \`[BLOCKING]\` | \`logic\` | it breaks | fix |

## Verdict
\`[READY]\` — looks fine to me
`)!
    expect(suggestedEvent(report)).toBe('REQUEST_CHANGES')
  })
})

describe('nothing to compose from', () => {
  it('returns null rather than an empty draft', () => {
    expect(parseReviewReport('')).toBeNull()
    expect(parseReviewReport('I had a look and it seems fine to me.')).toBeNull()
  })

  /** A findings section that is empty is a real answer: a clean review. */
  it('reads a clean review as a review with no findings', () => {
    const report = parseReviewReport('# PR review — x\n\n## Findings\n\n## Summary\nNothing to report.\n')
    expect(report).not.toBeNull()
    expect(report!.findings).toEqual([])
    expect(report!.summary).toBe('Nothing to report.')
  })
})
