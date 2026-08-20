/**
 * Getting a review back out of the report a review command wrote.
 *
 * The reviewing session already produces everything a GitHub review needs — a
 * location, a severity, the mechanism, a concrete scenario, the fix — and then
 * leaves it in a conversation for somebody to retype into github.com. This is
 * the half that turns that prose back into structure.
 *
 * It is a **parser, not an extractor**, and that is the whole design decision.
 * The tempting alternative was a small model reading the transcript, which is
 * what `sessionSummary.ts` does for a one-line summary. It would have been
 * wrong here twice over: it costs money on every review, and it re-writes
 * findings that were already written properly — flattening a mechanism, a
 * scenario with real values and a named regression test into whatever fits in a
 * sentence. The report already has a contract (`haddock-output-format`); a
 * contract you can parse is worth more than a model you have to pay.
 *
 * What it will not do is guess. A report this cannot read yields `null` rather
 * than a half-populated draft, because the failure mode that matters is not an
 * empty pane — it is a comment posted under your name that says something the
 * review did not say.
 */

/** Severities, as `haddock-output-format` defines them. */
export type ReportSeverity = 'BLOCKING' | 'WARN' | 'OK' | 'SKIP'

/** The report's own overall verdict. */
export type ReportVerdict = 'READY' | 'BLOCKED' | 'MISSING'

export interface ReportFinding {
  /** The location exactly as written, for showing when it cannot be resolved. */
  location: string
  /** The file, when the location parsed into one. */
  path?: string
  /** The line, when the location named one. A range keeps its first line. */
  line?: number
  severity: ReportSeverity
  category: string
  /** The `## Findings` table's terse cell. */
  issue: string
  /** The table's suggested-fix cell, when it had one. */
  fix?: string
  /**
   * The `## Detailed findings` block, whole.
   *
   * This is the comment body worth posting — mechanism, scenario with real
   * values, fix options, the regression test that should fail today. The table
   * cell is an index entry; this is the review.
   */
  detail?: string
  /**
   * A fenced code block found inside the detail, if any.
   *
   * Offered as a GitHub `suggestion` block, never assumed to be one: the
   * `Suggested fix` cell is prose ("add a `validateToken()` call"), and prose
   * inside a suggestion block is a diff the author cannot commit.
   */
  suggestion?: string
}

/** Somebody else's open thread, as the report listed it. */
export interface ReportOpenComment {
  author: string
  location?: string
  quote: string
}

export interface ParsedReport {
  title?: string
  findings: ReportFinding[]
  /** The paragraph to use as the review body. */
  summary?: string
  verdict?: ReportVerdict
  verdictReason?: string
  /**
   * Threads the report found already open on the pull request.
   *
   * Not yours, and the reason they are parsed at all is so the pane can say
   * which of your findings somebody has already raised. Posting a second
   * comment saying the same thing is how a review reads as noise.
   */
  openComments: ReportOpenComment[]
  /**
   * The reviewer's proof-of-work sections, kept whole.
   *
   * `## Scope`, `## Feature model` and the commit check are written for the
   * person who asked for the review, not for the author of the pull request.
   * They stay out of GitHub unless somebody asks for them, so they are kept
   * rather than dropped.
   */
  context: { scope?: string; featureModel?: string; commits?: string }
  /**
   * Where the report broke its own contract.
   *
   * The one thing a format gets you that a model does not: `haddock-output-format`
   * says one detailed block per `[BLOCKING]`/`[WARN]` finding, so six table rows
   * and three blocks is a report that is missing half of itself. Said out loud
   * rather than papered over by posting a table cell as a review comment.
   */
  violations: string[]
}

/** Where the report begins, if the transcript is carrying other things too. */
const TITLE = /^#\s+(?:PR review|Review)\b\s*[—–-]?\s*(.*)$/im

/** A section heading — exactly two hashes, so `###` blocks stay in their section. */
const SECTION = /^##(?!#)\s+(.+?)\s*$/

/** `[BLOCKING]`, with or without the backticks the format wraps it in. */
const SEVERITIES: ReportSeverity[] = ['BLOCKING', 'WARN', 'OK', 'SKIP']

function severityIn(text: string): ReportSeverity | null {
  const match = text.toUpperCase().match(/\[(BLOCKING|WARN|OK|SKIP)\]/)
  return match ? (match[1] as ReportSeverity) : null
}

/** Strip the decoration the format applies: backticks, brackets, stray quotes. */
function bare(text: string): string {
  return text.trim().replace(/^`+|`+$/g, '').replace(/^\[|\]$/g, '').trim()
}

/**
 * A location into a file and a line.
 *
 * Four shapes turn up and all four are the format being followed rather than
 * broken: `auth.ts:42`, a range `auth.ts:42-50`, a path with no line at all
 * (a whole-file finding), and the same wrapped in backticks. A Windows-style
 * `C:\…` is not a concern — these are repository-relative by construction —
 * but a trailing colon with no digits is, and it parses as no line rather than
 * as line zero.
 */
export function parseLocation(raw: string): { path?: string; line?: number } {
  const text = bare(raw)
  if (!text) return {}

  const match = text.match(/^(.*?):(\d+)(?:\s*[-–]\s*\d+)?$/)
  if (match) return { path: match[1]!.replace(/^\.\//, ''), line: Number(match[2]) }

  // No line — a whole-file finding, or a location the report truncated to
  // `a.ts:`. Both degrade the same way, to the file with no line, which is a
  // comment GitHub will still take.
  //
  // Only a path if it looks like one. A prose location ("the whole migration")
  // is not a file, and pretending it is puts a comment somewhere arbitrary.
  const path = text.replace(/:\s*$/, '').replace(/^\.\//, '')
  return /[/.]/.test(path) && !/\s/.test(path) ? { path } : {}
}

/** Sections of the report, keyed by their heading, lowercased. */
function sections(text: string): Map<string, string> {
  const out = new Map<string, string>()
  let heading: string | null = null
  let body: string[] = []

  const flush = () => {
    if (heading) out.set(heading.toLowerCase(), body.join('\n').trim())
  }

  for (const line of text.split('\n')) {
    const match = line.match(SECTION)
    if (match) {
      flush()
      // `## Open comments (3 total)` and `## Findings` should key the same way
      // whether or not the report put a count on the end.
      heading = match[1]!.replace(/\s*\(.*\)\s*$/, '').trim()
      body = []
      continue
    }
    body.push(line)
  }
  flush()

  return out
}

/**
 * The `## Findings` table.
 *
 * `| Location | Severity | Category | Issue | Suggested fix |` — five columns,
 * with the header and the `|---|` separator to skip. A row with fewer than four
 * cells is not a finding row; the format uses tables elsewhere (the coverage
 * line, the commit check) and a parser that took any pipe-delimited line would
 * turn those into review comments.
 */
function tableRows(body: string): ReportFinding[] {
  const out: ReportFinding[] = []

  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|[\s|:-]+\|$/.test(trimmed)) continue

    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    if (cells.length < 4) continue

    const severity = severityIn(cells[1] ?? '')
    if (!severity) continue // The header row, and anything else that is not one.

    const location = bare(cells[0] ?? '')
    out.push({
      location,
      ...parseLocation(location),
      severity,
      category: bare(cells[2] ?? '') || 'logic',
      issue: bare(cells[3] ?? ''),
      fix: bare(cells[4] ?? '') || undefined,
    })
  }

  return out
}

/**
 * The bullet form the same format prescribes for fewer than four findings:
 * `file:line — `[BADGE]` `category` — issue — suggested fix`.
 *
 * Both shapes have to be read, because which one a report used is decided by
 * how many findings it had — so a parser that only did tables would silently
 * produce an empty draft from exactly the reviews that went well.
 */
function bulletRows(body: string): ReportFinding[] {
  const out: ReportFinding[] = []

  for (const line of body.split('\n')) {
    const match = line.trim().match(/^[-*]\s+(.+)$/)
    if (!match) continue

    const parts = match[1]!.split(/\s+[—–]\s+/)
    if (parts.length < 2) continue

    const severity = severityIn(parts[1] ?? '')
    if (!severity) continue

    const location = bare(parts[0] ?? '')
    const category = bare((parts[1] ?? '').replace(/`?\[[A-Z]+\]`?/, '')) || 'logic'
    const rest = parts.slice(2)

    // The issue is what may itself contain an em dash — a fix rarely does — so
    // the last segment is the fix and everything before it is the issue.
    const fix = rest.length > 1 ? bare(rest[rest.length - 1]!) : undefined
    const issue = bare((rest.length > 1 ? rest.slice(0, -1) : rest).join(' — '))

    out.push({ location, ...parseLocation(location), severity, category, issue, fix })
  }

  return out
}

/** `### `[BLOCKING]` file:line — the consequence`, and the block under it. */
const DETAIL_HEAD = /^###\s+(.+?)\s*$/

interface DetailBlock {
  severity: ReportSeverity | null
  location: string
  consequence: string
  body: string
}

function detailBlocks(body: string): DetailBlock[] {
  const out: DetailBlock[] = []
  let current: DetailBlock | null = null
  let lines: string[] = []

  const flush = () => {
    if (current) out.push({ ...current, body: lines.join('\n').trim() })
  }

  for (const line of body.split('\n')) {
    const match = line.match(DETAIL_HEAD)
    if (match) {
      flush()
      const heading = match[1]!
      const severity = severityIn(heading)
      const withoutSeverity = heading.replace(/`?\[[A-Z]+\]`?/, '').trim()
      const split = withoutSeverity.split(/\s+[—–]\s+/)
      current = {
        severity,
        location: bare(split[0] ?? ''),
        consequence: split.slice(1).join(' — ').trim(),
        body: '',
      }
      lines = []
      continue
    }
    lines.push(line)
  }
  flush()

  return out
}

/** How two locations are compared: same file, same line, whatever the decoration. */
function key(finding: { path?: string; line?: number; location: string }): string {
  if (finding.path) return `${finding.path.toLowerCase()}:${finding.line ?? ''}`
  return finding.location.toLowerCase()
}

/** The first fenced code block, which is the only thing safe to offer as a suggestion. */
function fencedBlock(text: string): string | undefined {
  const match = text.match(/```[a-zA-Z0-9+-]*\n([\s\S]*?)```/)
  const body = match?.[1]?.replace(/\n$/, '')
  return body?.trim() ? body : undefined
}

/** `- [author] file:line — "quote" — status` */
function openComments(body: string): ReportOpenComment[] {
  const out: ReportOpenComment[] = []

  for (const line of body.split('\n')) {
    const match = line.trim().match(/^[-*]\s+\[([^\]]+)\]\s*(.*)$/)
    if (!match) continue

    const rest = match[2] ?? ''
    const quoted = rest.match(/["“]([^"”]+)["”]/)
    const location = rest.split(/\s+[—–]\s+/)[0]?.trim()

    out.push({
      author: match[1]!.trim(),
      location: location && location !== rest ? bare(location) : undefined,
      quote: quoted?.[1]?.trim() || bare(rest),
    })
  }

  return out
}

/**
 * The report, as structure.
 *
 * `null` means there was nothing here to compose from — no findings section at
 * all. That is a real answer and the pane says so, rather than offering an
 * empty review to send.
 */
export function parseReviewReport(text: string): ParsedReport | null {
  if (!text?.trim()) return null

  // A command narrates before it reports (`▸ phase 3/6: …`), and a session may
  // have said something after. The report starts at its own title when it has
  // one; without a title, the sections are still found from wherever they are.
  const titleMatch = text.match(TITLE)
  const report = typeof titleMatch?.index === 'number' ? text.slice(titleMatch.index) : text

  const found = sections(report)
  const findingsBody = found.get('findings')
  const detailsBody = found.get('detailed findings') ?? ''

  const rows = findingsBody
    ? (() => {
        const table = tableRows(findingsBody)
        return table.length ? table : bulletRows(findingsBody)
      })()
    : []

  const details = detailBlocks(detailsBody)
  const violations: string[] = []

  // A finding is the union of its row and its block, because either one can be
  // the one that is missing and both are worth knowing about.
  const byKey = new Map<string, ReportFinding>()
  for (const row of rows) byKey.set(key(row), row)

  for (const block of details) {
    const parsed = parseLocation(block.location)
    const stub: ReportFinding = {
      location: block.location,
      ...parsed,
      severity: block.severity ?? 'WARN',
      category: 'logic',
      issue: block.consequence,
    }
    const existing = byKey.get(key(stub))

    if (existing) {
      existing.detail = block.body
      existing.suggestion = fencedBlock(block.body)
      // The block's heading states the consequence in a line; the table cell is
      // terser. Prefer the fuller one for anything that shows a single line.
      if (block.consequence) existing.issue = block.consequence
    } else {
      violations.push(
        `"${block.location}" has a detailed block but no row in the findings table.`,
      )
      byKey.set(key(stub), { ...stub, detail: block.body, suggestion: fencedBlock(block.body) })
    }
  }

  const findings = [...byKey.values()]

  for (const finding of findings) {
    if ((finding.severity === 'BLOCKING' || finding.severity === 'WARN') && !finding.detail) {
      violations.push(
        `${finding.location || 'a finding'} is \`[${finding.severity}]\` with no detailed block — `
        + 'the table cell is all there is to post.',
      )
    }
    if (!finding.path) {
      violations.push(`"${finding.location}" is not a file and a line, so it cannot be posted inline.`)
    }
  }

  if (!findings.length && !found.has('findings')) return null

  // Either heading carries the closing paragraph: the full-review template ends
  // on `## Summary`, the shorter output shape on `## Verdict`. Reports in the
  // wild use both, so both are read rather than one being declared correct.
  const summarySection = found.get('summary')
  const verdictSection = found.get('verdict')
  const verdictText = verdictSection ?? summarySection ?? ''
  const verdictBadge = verdictText.toUpperCase().match(/\[(READY|BLOCKED|MISSING)\]/)

  const summary = (summarySection ?? verdictSection ?? '')
    .replace(/`?\[(READY|BLOCKED|MISSING)\]`?\s*[—–-]?\s*/i, '')
    .trim()

  return {
    title: titleMatch?.[1]?.trim() || undefined,
    findings,
    summary: summary || undefined,
    verdict: (verdictBadge?.[1] as ReportVerdict | undefined) ?? undefined,
    verdictReason: verdictSection?.split('\n')[0]?.trim() || undefined,
    openComments: openComments(found.get('open comments') ?? ''),
    context: {
      scope: found.get('scope') || undefined,
      featureModel: found.get('feature model') || undefined,
      commits: found.get('commit message check') || undefined,
    },
    violations,
  }
}

/**
 * What a finding should read like as a review comment.
 *
 * The detailed block when there is one, because that is the finding written
 * properly. The table cell only when there is nothing else — and then the fix
 * is appended, since "missing token validation" on its own is a complaint and
 * "…, add `validateToken()` before the handler" is a review.
 */
export function commentBody(finding: ReportFinding): string {
  if (finding.detail?.trim()) return finding.detail.trim()

  const issue = finding.issue.trim()
  const fix = finding.fix?.trim()
  return fix ? `${issue}\n\n**Suggested fix:** ${fix}` : issue
}

/**
 * Whether this finding is worth posting without being asked.
 *
 * `[OK]` is a nit the format itself says stays in the table, so it arrives
 * unchecked: a review whose comments are mostly nits trains the author to skim
 * the ones that are not. `[SKIP]` is a category that did not apply — it is
 * proof the reviewer looked, and means nothing to the author.
 */
export function includeByDefault(finding: ReportFinding): boolean {
  return finding.severity === 'BLOCKING' || finding.severity === 'WARN'
}

/**
 * The review event the report's own verdict implies.
 *
 * `APPROVE` is never returned. It is offered in the pane, because refusing to
 * offer it only moves that click to github.com — but nothing derived from a
 * machine's reading of a diff should arrive pre-selected as your approval.
 */
export function suggestedEvent(report: ParsedReport): 'COMMENT' | 'REQUEST_CHANGES' {
  if (report.verdict === 'BLOCKED') return 'REQUEST_CHANGES'
  if (report.findings.some(f => f.severity === 'BLOCKING')) return 'REQUEST_CHANGES'
  return 'COMMENT'
}
