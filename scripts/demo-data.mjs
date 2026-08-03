#!/usr/bin/env node
/**
 * Build a self-contained demo environment, and remove it again.
 *
 *   node scripts/demo-data.mjs seed     # build it
 *   node scripts/demo-data.mjs revert   # delete it
 *
 * Everything lives in its own Claude directory (~/.claude-demo by default) and
 * its own git repository. Nothing in your real ~/.claude is read, written or
 * needed — which is the point: the demo shows only what is seeded here, so
 * private plugins, internal marketplaces and personal agents cannot appear in
 * a screenshot by accident.
 *
 * Run the app against it:
 *
 *   CLAUDE_DIR=~/.claude-demo PORT=3200 node .output/server/index.mjs
 *
 * Sessions get real git worktrees, so file counts, commit counts and the merge
 * preview are computed from actual git state rather than mocked.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const git = (cwd, args) => exec('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })

const CLAUDE = process.env.DEMO_CLAUDE_DIR || join(homedir(), '.claude-demo')
const REPO = process.env.DEMO_REPO || join(homedir(), 'workspaces', 'storefront-demo')
const APP = join(CLAUDE, 'agents-ui')

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR
const NOW = Date.now()
const log = (msg) => console.log(`  ${msg}`)

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf-8')
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`

function frontmatter(fields, body) {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}

// ================================================================== agents

const AGENTS = [
  {
    slug: 'release-notes-writer',
    description: 'Turns a range of commits into release notes written for the people who use the product, not the people who wrote it. Use when cutting a release or preparing a changelog.',
    model: 'sonnet',
    color: '#5b5bd6',
    tools: 'Read, Grep, Glob, Bash',
    body: `You write release notes from git history.

## How to work

Read the commit range you are given. Group what you find under **Added**, **Changed**, **Fixed** and **Internal** — and put a change in only one of them.

## What matters

- **Write for the reader, not the author.** "Fixed a rounding error in invoice totals" beats "fix applyTax float".
- **Collapse churn.** Six commits fixing one feature are one line. A changelog reading "fix cart bug (3)" helps nobody.
- **Say nothing about internals unless they are visible.** A refactor belongs under Internal, or nowhere.
- **Never invent a change.** If a commit message is too vague to classify, list it under Internal verbatim and say you could not tell.

Ask before guessing at a version number. Getting that wrong is worse than asking.`,
  },
  {
    slug: 'test-gap-finder',
    description: 'Finds the paths through a change that no test exercises, and says which of them would actually matter. Use after writing a feature and before review.',
    model: 'opus',
    color: '#7c5cd6',
    tools: 'Read, Grep, Glob, Bash',
    body: `You find untested behaviour, then rank it by whether anyone would care.

## How to work

Read the change. For each branch, boundary and error path, decide whether a test covers it. Run the suite if one exists — coverage claims made without running it are guesses.

## What matters

- **A gap is only worth reporting if breaking it would be noticed.** An untested getter is not a finding.
- **Prefer the boundary.** Off-by-one, empty input, and the exact value a condition flips on are where bugs actually live.
- **Say what the test should assert**, not just that one is missing. "No test asserts the total stays an integer" is actionable; "pricing.ts needs tests" is not.
- **Distinguish missing from impossible.** If a path cannot be reached, say so — that is a simplification, not a gap.

Report nothing rather than pad the list.`,
  },
  {
    slug: 'sql-reviewer',
    description: 'Reviews database migrations for locking, index and rollback problems before they reach production. Use on any change under migrations/.',
    model: 'sonnet',
    color: '#0e8a6a',
    tools: 'Read, Grep, Glob',
    body: `You review migrations for what they will do to a live database.

## Check, in order

1. **Locks.** Does this take a lock that blocks reads or writes, and for how long? An \`ALTER TABLE\` on a large table during business hours is an outage.
2. **Indexes.** Is the new column queried? Is the index created concurrently? Is an old index now dead weight?
3. **Backfills.** Does this rewrite every row? Can it be batched?
4. **Rollback.** Can this be reversed without data loss? A dropped column cannot.
5. **Ordering.** Does the application deploy before or after this runs, and does it work in the gap between them?

## What matters

Say which of these apply and which do not. A review that lists every possible concern regardless of relevance teaches the reader to skim it.

Give the row count at which a concern becomes real. "This is fine under about 100k rows" is far more useful than "this may be slow".`,
  },
  {
    slug: 'incident-summariser',
    description: 'Turns a noisy alert thread into a short account of what broke, when, and what is still unknown. Use during or just after an incident.',
    model: 'haiku',
    color: '#e5484d',
    tools: 'Read, Grep, Bash',
    body: `You compress incident noise into something a person arriving late can read in thirty seconds.

## Produce

**What broke** — one sentence, in terms of what users could not do.
**When** — first symptom, detection, mitigation.
**What we know** — established facts only.
**What we do not know** — the open questions, named.

## What matters

- **Separate fact from theory, always.** "Latency rose at 14:02" and "we think the deploy caused it" belong in different sections. Blurring them is how an incident review starts from a false premise.
- **Timestamps, not "recently".**
- **No blame, no speculation about intent.** What happened, not who did it.
- **If the cause is unknown, say so plainly.** An empty "root cause" section is more honest than a plausible guess.`,
  },
  {
    slug: 'api-contract-checker',
    description: 'Compares two versions of an API schema and reports what would break an existing client. Use before publishing a spec change.',
    model: 'opus',
    color: '#3b6fd4',
    tools: 'Read, Grep, Glob, Bash',
    body: `You decide whether an API change is breaking, from the perspective of a client you cannot update.

## Breaking

- Removing a field, endpoint or enum value
- Making an optional request field required
- Narrowing a type, or tightening validation
- Changing a status code, or the shape of an error
- Renaming anything

## Not breaking

- Adding an optional request field
- Adding a response field
- Widening a type or loosening validation

## What matters

For each breaking change, name **which client behaviour breaks**. "Removing \`user.nickname\` breaks any client rendering it" is a finding; "removed a field" is a diff.

If a change is ambiguous, treat it as breaking and explain the assumption. The cost of being wrong is asymmetric.`,
  },
  {
    slug: 'onboarding-buddy',
    description: 'Answers "how does this work here" for someone new to the codebase, by reading it rather than guessing. Use for questions about conventions, structure or where something lives.',
    model: 'sonnet',
    color: '#b45309',
    tools: 'Read, Grep, Glob',
    body: `You explain this codebase to someone who has just joined.

## How to work

Answer from the code, not from what is usual elsewhere. Read before answering; cite the file and line so the answer can be checked.

## What matters

- **Point at the real example.** "Look at \`src/server/cart.ts\` for the pattern" beats a description of the pattern.
- **Say when the codebase is inconsistent.** Two competing conventions is a fact worth knowing, and pretending there is one correct way sends people to argue with reviewers.
- **Explain why, when the code says why.** If a comment gives the reason, quote it. If nothing does, say the reason is not recorded rather than inventing one.
- **Never guess at history.** "I do not know why it was done this way" is a complete answer.`,
  },
]

// ================================================================ commands

const COMMANDS = [
  {
    path: 'standup.md',
    description: 'Summarise what changed since yesterday, ready to paste into standup',
    'argument-hint': '[since]',
    body: `Summarise activity since $ARGUMENTS (default: yesterday morning).

Cover, in this order:

1. **Merged** — what landed, in user-facing terms
2. **In review** — open PRs and how long they have been waiting
3. **Blocked** — anything that has not moved and why

Keep it under ten lines. If nothing is blocked, say so in three words rather than omitting the heading.`,
  },
  {
    path: 'ship/preflight.md',
    description: 'Run every check that must pass before a release goes out',
    body: `Run the pre-release checks and report a single verdict.

1. \`pnpm test\` — the full suite, not a subset
2. \`pnpm build\` — a production build
3. \`git status\` — the checkout must be clean
4. Confirm the version in \`package.json\` matches the tag being cut

Report **ready** or **not ready**, and if not ready, exactly which check failed and its output. Do not summarise a failure — paste it.`,
  },
  {
    path: 'ship/changelog.md',
    description: 'Draft release notes from the commits since the last tag',
    'argument-hint': '[version]',
    body: `Draft release notes for $ARGUMENTS.

Use the \`release-notes-writer\` agent. Give it the commit range from the previous tag to HEAD.

Write the result to \`RELEASE-NOTES.md\` and leave it uncommitted so it can be edited before it ships.`,
  },
  {
    path: 'review/pr.md',
    description: 'Review a pull request the way a careful colleague would',
    'argument-hint': '<pr-number>',
    body: `Review PR #$ARGUMENTS.

Read the full diff before commenting on any part of it.

Report in three groups:

- **Must fix** — correctness, security, data loss
- **Worth considering** — clarity, structure, missing tests
- **Nits** — style, naming

State plainly if a group is empty. A review that manufactures a "must fix" to look thorough wastes the author's afternoon.`,
  },
  {
    path: 'review/security.md',
    description: 'Check a change for the security mistakes that actually get made',
    body: `Review the current diff for security problems, in this order:

1. **Injection** — SQL, shell, template. Is any user input concatenated?
2. **Authorisation** — is every new endpoint checking who is calling it?
3. **Secrets** — anything hardcoded, logged, or sent to a third party
4. **Deserialisation and file paths** — can input escape the directory it should stay in?

For each finding, give the input that triggers it. A vulnerability without a concrete path to exploit it is a hypothesis, and should be labelled as one.`,
  },
  {
    path: 'db/migrate-check.md',
    description: 'Check a migration for locking and rollback problems before it runs',
    body: `Review the pending migrations with the \`sql-reviewer\` agent.

Then answer two questions directly:

- Can this run during business hours?
- Can it be rolled back without losing data?

If either answer is no, say what would have to change to make it yes.`,
  },
  {
    path: 'debug/trace.md',
    description: 'Trace a value backwards through the codebase to where it comes from',
    'argument-hint': '<symbol>',
    body: `Trace \`$ARGUMENTS\` back to its origin.

Work backwards from where it is used to where it is set, listing each hop with its file and line. Stop at the point it enters the system — a request body, an environment variable, a database read.

Say which hops you verified by reading and which you inferred. An inferred hop is where a trace goes wrong.`,
  },
  {
    path: 'triage.md',
    description: 'Sort new issues into labels, priority and owner',
    body: `Triage the issues opened since yesterday.

For each one decide: is it a **bug**, a **feature**, a **question**, or a **duplicate**?

For bugs, establish whether it reproduces before assigning a priority. An unreproduced bug is a report, not a bug, and should be labelled \`needs-info\` rather than guessed at.

Propose labels and priority. Do not apply them until the proposal has been reviewed.`,
  },
]

// ================================================================== skills

const SKILLS = [
  {
    name: 'writing-postmortems',
    description: 'How to write a postmortem that people actually read and act on. Use after an incident is resolved, when writing up what happened.',
    body: `# Writing postmortems

## Shape

**Impact first.** What could users not do, and for how long. Before any narrative.

**Timeline second.** Timestamps, one line each, no interpretation.

**Cause third.** What actually happened, distinguished from what was suspected during the incident.

**Actions last.** Each with an owner and a date, or it will not happen.

## Rules

- Blameless means describing decisions in terms of the information available at the time, not omitting that a decision was made.
- "Human error" is never a root cause. It is a description of a system that permitted the error.
- An action item nobody owns is a wish. Delete it or assign it.
- If the cause is still unknown when you write, publish anyway and say so.`,
  },
  {
    name: 'reviewing-migrations',
    description: 'What to check before a database migration runs against production data. Use when reviewing any schema change.',
    body: `# Reviewing migrations

## The five questions

1. **What does it lock, and for how long?**
2. **Is the new column indexed, and was the index built concurrently?**
3. **Does it rewrite every row?** If so, can it batch?
4. **Can it be rolled back?** Dropped columns cannot.
5. **Does the app work in the window between deploy and migrate?**

## Scale changes the answer

Most of these are irrelevant under 100k rows and critical above 10M. Always state the row count your answer assumes — a review that says "this will lock the table" without saying for how long is not actionable.`,
  },
  {
    name: 'naming-things',
    description: 'Conventions for naming in this codebase, and the reasoning behind them. Use when adding a new module, function or database column.',
    body: `# Naming

## Conventions

| Thing | Style | Example |
| --- | --- | --- |
| Files | kebab-case | \`order-history.ts\` |
| Functions | verb first | \`buildInvoice\`, not \`invoiceBuilder\` |
| Booleans | question form | \`hasExpired\`, not \`expired\` |
| Money | unit in the name | \`priceCents\`, never \`price\` |

## The one that matters

**Put the unit in the name.** Every money bug in this codebase traces back to a variable called \`price\` that was sometimes pounds and sometimes pence. \`priceCents\` cannot be misread.

The same applies to time: \`timeoutMs\`, not \`timeout\`.`,
  },
  {
    name: 'debugging-slow-endpoints',
    description: 'A method for finding why an endpoint got slow, without guessing. Use when an API endpoint has regressed in latency.',
    body: `# Debugging slow endpoints

## Order of work

1. **Confirm it is slow, and for whom.** p50 and p99 tell different stories. A p99 regression with a flat p50 usually means one segment of traffic, not a general slowdown.
2. **Find when it changed.** Correlate with deploys before reading any code.
3. **Measure, then read.** Reading code first produces a plausible theory you will then defend.
4. **Check the obvious three:** a query without an index, an N+1, a copy inside a loop.

## The trap

The most convincing explanation is often the one you found first. Before changing anything, ask what evidence would prove it wrong — then look for that.`,
  },
]

// =============================================================== workflows

const WORKFLOWS = [
  {
    slug: 'ship-a-release',
    name: 'Ship a release',
    description: 'Everything between "the code is ready" and "the tag is pushed": find untested paths, check the API contract, then write the notes.',
    steps: [
      { agentSlug: 'test-gap-finder', label: 'Find untested paths' },
      { agentSlug: 'api-contract-checker', label: 'Check for breaking API changes' },
      { agentSlug: 'release-notes-writer', label: 'Draft the release notes' },
    ],
    createdAgo: 9 * DAY,
    lastRunAgo: 2 * DAY,
  },
  {
    slug: 'review-a-pull-request',
    name: 'Review a pull request',
    description: 'A second pass over a PR before a human spends time on it — migrations first, then whatever the tests do not cover.',
    steps: [
      { agentSlug: 'sql-reviewer', label: 'Review any migrations' },
      { agentSlug: 'test-gap-finder', label: 'Find gaps in coverage' },
    ],
    createdAgo: 14 * DAY,
    lastRunAgo: 6 * HOUR,
  },
  {
    slug: 'handle-an-incident',
    name: 'Handle an incident',
    description: 'Summarise what is known while it is still happening, then explain the affected code to whoever picks it up next.',
    steps: [
      { agentSlug: 'incident-summariser', label: 'Summarise what is known' },
      { agentSlug: 'onboarding-buddy', label: 'Explain the affected area' },
    ],
    createdAgo: 21 * DAY,
    lastRunAgo: 4 * DAY,
  },
]

// ================================================================= plugins

const MARKETPLACE = {
  id: 'storefront-tools',
  plugins: [
    {
      name: 'shipkit',
      version: '1.4.0',
      description: 'Release tooling: preflight checks, changelog drafting and tag hygiene.',
      commands: {
        'tag.md': { description: 'Cut and push an annotated release tag', body: 'Create an annotated tag for the current version and push it.\n\nRefuse if the checkout is dirty or the tests have not been run.' },
        'verify.md': { description: 'Verify a published release matches the tag', body: 'Compare the published artefact against the tag it claims to come from.\n\nReport any file that differs.' },
      },
      skills: {
        'cutting-a-release': {
          description: 'The order of operations for cutting a release, and what to do when a step fails partway.',
          body: '# Cutting a release\n\n1. Preflight — tests, build, clean checkout\n2. Version bump, committed on its own\n3. Tag, annotated, matching the version exactly\n4. Push the tag, then the branch\n\n## When it fails halfway\n\nA pushed tag is public. Do not move it — cut a patch instead. Moving a tag breaks every checkout that already fetched it.',
        },
      },
    },
    {
      name: 'pgtools',
      version: '0.9.2',
      description: 'Postgres helpers: migration review, index advice and lock analysis.',
      commands: {
        'explain.md': { description: 'Explain a query plan in plain language', body: 'Run EXPLAIN ANALYZE on the given query and explain the plan.\n\nName the single most expensive node and why it is expensive.' },
      },
      skills: {
        'index-selection': {
          description: 'Choosing the right index for a query, and knowing when an index will not help.',
          body: '# Index selection\n\n## Rules of thumb\n\n- A composite index serves any **prefix** of its columns, not any subset.\n- An index on a low-cardinality column rarely helps; the planner will ignore it.\n- Adding an index costs every write. Two indexes on a hot write path is usually one too many.\n\n## When an index will not help\n\nIf the query returns more than roughly 10% of the table, a sequential scan is genuinely faster. Adding an index there makes writes slower and reads no faster.',
        },
      },
    },
  ],
}

// ================================================================ sessions

const SESSIONS = [
  {
    title: 'Add faceted search to the product list',
    commits: [
      {
        message: 'Add tag and price filters to catalogue search',
        files: {
          'src/lib/catalogue.ts': `export interface Product {
  sku: string
  title: string
  priceCents: number
  tags: string[]
}

export interface Facets {
  term?: string
  tags?: string[]
  maxPriceCents?: number
}

export function search(products: Product[], facets: Facets = {}): Product[] {
  const needle = facets.term?.trim().toLowerCase() ?? ''

  return products.filter((product) => {
    if (needle && !product.title.toLowerCase().includes(needle)) return false
    if (facets.maxPriceCents != null && product.priceCents > facets.maxPriceCents) return false
    if (facets.tags?.length && !facets.tags.every(tag => product.tags.includes(tag))) return false
    return true
  })
}
`,
        },
      },
      {
        message: 'Cover the facet combinations with tests',
        files: {
          'src/lib/catalogue.test.ts': `import { describe, expect, it } from 'vitest'
import { search, type Product } from './catalogue'

const products: Product[] = [
  { sku: 'a', title: 'Wool scarf', priceCents: 2400, tags: ['winter', 'wool'] },
  { sku: 'b', title: 'Cotton scarf', priceCents: 1200, tags: ['summer'] },
]

describe('search', () => {
  it('returns everything when no facets are given', () => {
    expect(search(products)).toHaveLength(2)
  })

  it('requires every requested tag, not just one', () => {
    expect(search(products, { tags: ['winter', 'wool'] })).toHaveLength(1)
  })

  it('treats maxPrice as inclusive', () => {
    expect(search(products, { maxPriceCents: 1200 })).toHaveLength(1)
  })
})
`,
        },
      },
    ],
    uncommitted: {},
    turns: [
      {
        input: 'The product list only does title matching. Can you add filtering by tag and by maximum price?',
        output: `Looking at \`src/lib/catalogue.ts\`, \`search\` takes a bare string and matches on title only. Widening that to a facet object keeps every call site honest — a second string parameter would have been easy to pass in the wrong order.

### What changed

\`\`\`ts
export interface Facets {
  term?: string
  tags?: string[]
  maxPriceCents?: number
}
\`\`\`

\`search(products, facets)\` now applies three independent predicates:

- **term** — unchanged title substring match, still case-insensitive
- **tags** — every requested tag must be present, not just one
- **maxPriceCents** — inclusive, so a filter of £12.00 includes a £12.00 item

The tag rule is the one worth confirming. \`every\` rather than \`some\` means selecting *winter* and *wool* narrows the results rather than widening them, which is what a faceted UI implies. Say the word if you wanted it the other way.`,
        toolCalls: [
          { toolName: 'Read', preview: 'src/lib/catalogue.ts — 14 lines' },
          { toolName: 'Edit', preview: 'src/lib/catalogue.ts' },
        ],
        costUsd: 0.0412, durationMs: 18_400,
      },
      {
        input: 'Good, that is what I wanted. Add tests for it.',
        output: `Added \`src/lib/catalogue.test.ts\` covering the three cases that could regress quietly:

| Case | Why it is worth a test |
| --- | --- |
| No facets | The empty-object default must not filter everything out |
| Two tags | Guards the \`every\` vs \`some\` decision |
| Boundary price | Catches an off-by-one if \`>\` ever becomes \`>=\` |

All three pass. Both commits are on the branch and the workspace is clean, so this is ready to merge whenever you are.`,
        toolCalls: [
          { toolName: 'Write', preview: 'src/lib/catalogue.test.ts' },
          { toolName: 'Bash', preview: 'pnpm vitest run — 3 passed' },
        ],
        costUsd: 0.0286, durationMs: 12_900,
      },
    ],
  },
  {
    title: 'Fix rounding errors in checkout totals',
    commits: [
      {
        message: 'Round tax to whole cents instead of carrying floats',
        files: {
          'src/lib/pricing.ts': `export interface LineItem {
  sku: string
  quantity: number
  unitPriceCents: number
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0)
}

/**
 * Money is integer cents everywhere else, so tax has to come back as an
 * integer too — carrying a float here is what put 0.30000000000000004 on an
 * invoice.
 */
export function applyTax(amountCents: number, rate: number): number {
  return Math.round(amountCents * (1 + rate))
}
`,
        },
      },
    ],
    uncommitted: {
      'src/lib/pricing.test.ts': `import { expect, it } from 'vitest'
import { applyTax } from './pricing'

it('always returns whole cents', () => {
  expect(Number.isInteger(applyTax(1999, 0.2))).toBe(true)
})
`,
    },
    turns: [
      {
        input: 'Customers are seeing totals like £24.130000000000003 on the invoice. Can you find where that comes from?',
        output: `Found it. \`applyTax\` in \`src/lib/pricing.ts\`:

\`\`\`ts
return amountCents * (1 + rate)
\`\`\`

Every other amount in the codebase is an integer number of cents. This one multiplies by \`1 + rate\` and returns whatever float falls out, so \`2011 * 1.2\` becomes \`2413.2000000000003\` and the formatter renders it verbatim.

Rounding at the point the value stops being exact:

\`\`\`ts
return Math.round(amountCents * (1 + rate))
\`\`\`

One thing to decide before this ships: \`Math.round\` rounds a half-cent up, which favours the customer on odd amounts. If finance expects banker's rounding, that is a different function and I would rather you told me than guessed.

I have left a test uncommitted asserting the integer property — worth a look before it goes in.`,
        toolCalls: [
          { toolName: 'Grep', preview: 'applyTax — 2 matches' },
          { toolName: 'Read', preview: 'src/lib/pricing.ts — 16 lines' },
          { toolName: 'Edit', preview: 'src/lib/pricing.ts' },
        ],
        costUsd: 0.0521, durationMs: 22_700,
      },
    ],
  },
  {
    title: 'Draft the v2.1 release notes',
    commits: [],
    uncommitted: {
      'RELEASE-NOTES.md': `# v2.1

## Added

- Faceted product search — filter by tag and maximum price
- Cart contents now survive a page reload

## Fixed

- Invoice totals no longer show floating point noise
- Search no longer drops results when the term has trailing whitespace

## Internal

- Pricing moved into \`src/lib/pricing.ts\`
`,
    },
    turns: [
      {
        input: 'Draft release notes for v2.1 from the commits since v2.0.4.',
        output: `Drafted \`RELEASE-NOTES.md\` from the eleven commits since \`v2.0.4\`, grouped into **Added**, **Fixed** and **Internal**.

Two judgement calls worth your eye:

1. I folded six commits about cart persistence into a single line. The individual commits are churn on the same feature, and a changelog reading "fix cart bug (3)" helps nobody.
2. The pricing refactor is listed under *Internal* rather than *Fixed*, even though it changed a visible number. The user-facing part is already covered by the invoice line above it, and listing it twice overstates the change.

It is uncommitted so you can edit before it lands.`,
        toolCalls: [
          { toolName: 'Bash', preview: 'git log v2.0.4..HEAD --oneline — 11 commits' },
          { toolName: 'Write', preview: 'RELEASE-NOTES.md' },
        ],
        costUsd: 0.0198, durationMs: 9_800,
      },
    ],
  },
  {
    title: 'Investigate slow cart API responses',
    commits: [],
    uncommitted: {},
    turns: [
      {
        input: 'The /api/cart endpoint got slow this week. Have a look before we change anything.',
        output: `Read through \`src/server/cart.ts\` without changing anything, as asked.

\`getCart\` is an in-memory \`Map\` lookup, so the endpoint itself is not the slow part. What stands out is that **\`addToCart\` copies the whole cart on every insert**:

\`\`\`ts
carts.set(userId, [...getCart(userId), item])
\`\`\`

That is O(n) per item and O(n²) to build a cart. Invisible at three items, noticeable at the two hundred a wholesale order carries — which matches "this week", since the wholesale pilot started Monday.

Before changing it I would want to confirm the theory rather than assume it:

- Is the slowdown on \`addToCart\` specifically, or spread across the endpoint?
- Are the slow requests the wholesale accounts?

If both hold, pushing onto the existing array is a two-line fix. I have not made it yet — the measurement should come first.`,
        toolCalls: [
          { toolName: 'Read', preview: 'src/server/cart.ts — 12 lines' },
          { toolName: 'Grep', preview: 'addToCart — 4 matches' },
        ],
        costUsd: 0.0334, durationMs: 15_200,
      },
    ],
  },
]

// ================================================================= rituals

const RITUALS = [
  {
    title: 'Morning briefing',
    input: '/standup',
    invocation: '/standup',
    recurrence: { hour: 8, minute: 0, days: [1, 2, 3, 4, 5] },
    permission: 'readonly',
    origin: 'user',
    enabled: true,
    lastRunAgo: 26 * HOUR,
    run: {
      status: 'completed',
      output: `## Overnight

**CI** — green on \`main\`. The nightly build took 6m12s, about a minute slower than usual; the extra time is all in \`pnpm install\`.

**Pull requests waiting on you**

| PR | Title | Waiting |
| --- | --- | --- |
| #418 | Faceted product search | 2 days |
| #421 | Round tax to whole cents | 4 hours |

**Issues opened since yesterday**

- \`#423\` Cart empties when the session cookie expires — two reports, both wholesale accounts
- \`#424\` Search ignores trailing whitespace

Nothing is on fire. #423 has a second reporter, which is usually the point at which it stops being a one-off.`,
      costUsd: 0.0231, durationMs: 14_200,
      toolCalls: [
        { toolName: 'Bash', preview: 'gh pr list --json number,title — 2 open' },
        { toolName: 'Bash', preview: 'gh issue list --limit 20 — 2 new' },
      ],
    },
  },
  {
    title: 'Triage new issues',
    input: '/triage',
    invocation: '/triage',
    recurrence: { hour: 9, minute: 30, days: [1, 2, 3, 4, 5] },
    permission: 'edits',
    origin: 'user',
    enabled: true,
    lastRunAgo: 25 * HOUR,
    run: {
      status: 'completed',
      needsAttention: true,
      deniedTools: ['Bash(gh issue edit:*)'],
      suggestedRules: ['Bash(gh issue edit:*)'],
      output: `Read the four issues opened overnight and worked out where each belongs.

1. **#423 — Cart empties on cookie expiry.** Two reporters, both wholesale. Reproduces. Should be \`bug\` / \`P1\`.
2. **#424 — Search ignores trailing whitespace.** One line in \`catalogue.ts\`. \`bug\` / \`good-first-issue\`.
3. **#425 — Add dark mode.** Already tracked in #201. Duplicate.
4. **#426 — Question about bulk pricing.** Support, not engineering.

I could not apply any of it. Labelling needs \`gh issue edit\`, which this ritual is not allowed to run, so the four issues are untouched and still unlabelled.`,
      costUsd: 0.0447, durationMs: 26_800,
      toolCalls: [
        { toolName: 'Bash', preview: 'gh issue list --json number,title,body — 4 issues' },
        { toolName: 'Bash', preview: 'permission denied: gh issue edit', isError: true },
      ],
    },
  },
  {
    title: 'Migration review',
    input: '/db:migrate-check',
    invocation: '/db:migrate-check',
    recurrence: { hour: 7, minute: 0, days: [1] },
    permission: 'readonly',
    origin: 'team',
    pluginName: 'pgtools',
    enabled: true,
    lastRunAgo: 3 * DAY,
    run: {
      status: 'completed',
      output: `Two migrations pending on \`main\`.

**\`0042_add_product_tags.sql\`** — adds a \`tags text[]\` column with a GIN index.

The index is created **without** \`CONCURRENTLY\`, so it takes an \`ACCESS EXCLUSIVE\` lock on \`products\` for the duration. At the current 2.3M rows that is roughly 40 seconds of blocked reads and writes.

\`\`\`sql
CREATE INDEX CONCURRENTLY idx_products_tags ON products USING gin (tags);
\`\`\`

Reversible, so rollback is fine.

**\`0043_backfill_tags.sql\`** — updates every row in one statement. That is a 2.3M row rewrite in a single transaction, holding the lock throughout. It should batch.

Neither is safe during business hours as written.`,
      costUsd: 0.0389, durationMs: 31_500,
      toolCalls: [
        { toolName: 'Glob', preview: 'migrations/*.sql — 2 pending' },
        { toolName: 'Read', preview: '0042_add_product_tags.sql — 8 lines' },
      ],
    },
  },
  {
    title: 'End-of-day summary',
    input: '/standup today',
    invocation: '/standup',
    recurrence: { hour: 17, minute: 30, days: [1, 2, 3, 4, 5] },
    permission: 'edits',
    origin: 'user',
    enabled: false,
    lastRunAgo: 8 * DAY,
    run: {
      status: 'failed',
      error: 'Could not reach the GitHub API: request timed out after 30s',
      output: '',
      costUsd: 0.0021, durationMs: 30_400,
      toolCalls: [{ toolName: 'Bash', preview: 'gh api /repos/... — timed out', isError: true }],
    },
  },
]

// ============================================== standalone agent/command runs

const EXTRA_RUNS = [
  {
    kind: 'agent', agentSlug: 'sql-reviewer', title: 'sql-reviewer',
    input: 'Review the pending migrations on this branch',
    ago: 4 * HOUR, costUsd: 0.0367, durationMs: 24_100,
    output: `Reviewed \`0044_drop_legacy_price.sql\`.

**This cannot be rolled back.** It drops \`products.price\`, and the data goes with it. If anything still reads that column after deploy, there is no recovery short of a restore.

\`\`\`sql
ALTER TABLE products DROP COLUMN price;
\`\`\`

\`price\` still appears in two places: \`src/server/reports.ts:88\` and a materialised view \`monthly_revenue\`. The view will break immediately — it is not lazily evaluated.

The usual shape for this is three deploys: stop reading the column, then drop it, then clean up. Doing it in one is what makes it irreversible.

Locking itself is not a concern — \`DROP COLUMN\` is metadata-only in Postgres and returns in milliseconds.`,
    toolCalls: [
      { toolName: 'Glob', preview: 'migrations/*.sql — 1 pending' },
      { toolName: 'Grep', preview: 'products.price — 2 matches' },
    ],
  },
  {
    kind: 'agent', agentSlug: 'test-gap-finder', title: 'test-gap-finder',
    input: 'What is untested in the checkout path?',
    ago: 7 * HOUR, costUsd: 0.0455, durationMs: 33_600,
    output: `Ran the suite first: 68 passing, and it does cover the happy path thoroughly.

Three gaps, only the first of which I would block on.

**1. \`applyTax\` is never tested at a boundary.** Every existing case uses an amount that divides evenly, so the rounding introduced last week is not exercised at all. A test at \`1999\` cents and 20% would have caught it.

**2. An empty cart returns \`NaN\`.** \`subtotal([])\` is \`0\`, but \`applyTax(0, rate)\` is only reached when the cart has items — the empty case short-circuits earlier and returns \`undefined\`, which the formatter renders as \`NaN\`. Reachable: it is what a user sees after removing their last item.

**3. Negative quantities are accepted.** No validation and no test. Whether that matters depends on whether quantity is ever client-supplied — I could not establish that from the code, so I am flagging rather than asserting.

Nothing else is worth a test. The getters and the type guards would only add noise.`,
    toolCalls: [
      { toolName: 'Bash', preview: 'pnpm vitest run — 68 passed' },
      { toolName: 'Read', preview: 'src/lib/pricing.ts — 21 lines' },
      { toolName: 'Grep', preview: 'subtotal( — 6 matches' },
    ],
  },
  {
    kind: 'command', invocation: '/ship:preflight', title: 'Pre-release checks',
    input: '/ship:preflight',
    ago: 2 * DAY, costUsd: 0.0122, durationMs: 71_400,
    status: 'completed',
    output: `**Not ready.**

Three of four checks pass:

- \`pnpm test\` — 68 passed
- \`pnpm build\` — succeeded in 41s
- \`git status\` — clean
- **Version mismatch** — \`package.json\` says \`2.0.4\`, the tag being cut is \`v2.1.0\`

\`\`\`
package.json:  "version": "2.0.4"
tag:           v2.1.0
\`\`\`

Bump the version and commit it before tagging, or the published artefact will disagree with its own tag.`,
    toolCalls: [
      { toolName: 'Bash', preview: 'pnpm vitest run — 68 passed' },
      { toolName: 'Bash', preview: 'pnpm build — done in 41.2s' },
      { toolName: 'Read', preview: 'package.json — version 2.0.4' },
    ],
  },
  {
    kind: 'command', invocation: '/review:security', title: 'Security review',
    input: '/review:security',
    ago: 5 * DAY, costUsd: 0.0288, durationMs: 19_900,
    output: `Reviewed the current diff. **One finding, one non-finding.**

### Finding — search term reaches SQL unescaped

\`src/server/search.ts:34\` interpolates the term directly:

\`\`\`ts
const rows = await db.raw(\`SELECT * FROM products WHERE title ILIKE '%\${term}%'\`)
\`\`\`

A term of \`'; DROP TABLE products; --\` reaches the database intact. It is reachable from the public search box with no authentication.

Parameterising it fixes it outright — the driver already supports it, this path just predates the rest.

### Not a finding — the \`tags\` array

I looked at \`tags\` being passed to a \`= ANY(...)\` clause and it is parameterised correctly. Mentioning it only so you know it was checked rather than skipped.`,
    toolCalls: [
      { toolName: 'Grep', preview: 'db.raw( — 3 matches' },
      { toolName: 'Read', preview: 'src/server/search.ts — 51 lines' },
    ],
  },
]

// =================================================================== build

function buildRun({ id, title, input, output = '', createdAt, durationMs, costUsd,
                    status = 'completed', error, toolCalls = [], sessionId, scheduleId,
                    invocation, agentSlug, kind = 'chat', needsAttention, deniedTools,
                    suggestedRules, projectDir }) {
  const events = []
  let seq = 0
  const push = (event) => events.push({ seq: seq++, at: createdAt + seq * 120, ...event })

  push({ type: 'status', status: 'running' })
  toolCalls.forEach((call, index) => {
    push({ type: 'tool_use', id: `t${index}`, toolName: call.toolName, input: call.input ?? {} })
    push({ type: 'tool_result', id: `t${index}`, preview: call.preview, isError: Boolean(call.isError) })
  })
  if (output) push({ type: 'text', text: output })
  if (error) push({ type: 'error', error })
  push({ type: 'status', status })

  return {
    id, kind, title, input, invocation, agentSlug, projectDir, status,
    createdAt, startedAt: createdAt + 400, completedAt: createdAt + durationMs,
    output, error,
    stats: {
      usage: { input_tokens: 8_400 + Math.round(costUsd * 40_000), output_tokens: Math.round(output.length / 3.6) },
      costUsd, durationMs, numTurns: 1, model: 'claude-opus-5',
      permissionDenials: (deniedTools ?? []).map(toolName => ({ toolName })),
    },
    needsAttention, deniedTools, suggestedRules, scheduleId, sessionId, events,
  }
}

const REPO_FILES = {
  'README.md': `# Storefront

The customer-facing shop. Next.js on the front, Postgres behind an API layer.

## Running it

    pnpm install
    pnpm dev

## Layout

| Directory | What lives there |
| --- | --- |
| \`src/app\` | Routes and pages |
| \`src/lib\` | Cart, pricing and catalogue logic |
| \`src/server\` | API handlers and database access |
`,
  'package.json': json({
    name: 'storefront', version: '2.0.4', private: true,
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run' },
  }),
  'src/lib/pricing.ts': `export interface LineItem {
  sku: string
  quantity: number
  unitPriceCents: number
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0)
}

export function applyTax(amountCents: number, rate: number): number {
  return amountCents * (1 + rate)
}
`,
  'src/lib/catalogue.ts': `export interface Product {
  sku: string
  title: string
  priceCents: number
  tags: string[]
}

export function search(products: Product[], term: string): Product[] {
  const needle = term.trim().toLowerCase()
  if (!needle) return products
  return products.filter(p => p.title.toLowerCase().includes(needle))
}
`,
  'src/server/cart.ts': `import type { LineItem } from '../lib/pricing'

const carts = new Map<string, LineItem[]>()

export function getCart(userId: string): LineItem[] {
  return carts.get(userId) ?? []
}

export function addToCart(userId: string, item: LineItem): void {
  carts.set(userId, [...getCart(userId), item])
}
`,
}

const HISTORY = [
  'Initial storefront scaffold',
  'Add catalogue search helper',
  'Move cart state behind the server layer',
  'Extract pricing into its own module',
  'Bump to 2.0.4',
]

const branchFor = (title, id) =>
  `agents-ui/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')}-${id}`

async function seed() {
  for (const [label, path] of [['config directory', CLAUDE], ['repository', REPO]]) {
    if (existsSync(path)) throw new Error(`${label} already exists at ${path}. Run \`revert\` first.`)
  }

  // ---- config directory
  await write(join(CLAUDE, 'settings.json'), json({
    permissions: { allow: ['Read(**)', 'Grep(**)', 'Glob(**)'], deny: [] },
    alwaysThinkingEnabled: false,
  }))

  for (const agent of AGENTS) {
    await write(join(CLAUDE, 'agents', `${agent.slug}.md`), frontmatter({
      name: agent.slug, description: agent.description, model: agent.model,
      color: agent.color, tools: agent.tools,
    }, agent.body))
  }
  log(`${AGENTS.length} agents`)

  for (const command of COMMANDS) {
    await write(join(CLAUDE, 'commands', command.path), frontmatter({
      description: command.description, 'argument-hint': command['argument-hint'],
    }, command.body))
  }
  log(`${COMMANDS.length} commands`)

  for (const skill of SKILLS) {
    await write(join(CLAUDE, 'skills', skill.name, 'SKILL.md'), frontmatter({
      name: skill.name, description: skill.description,
    }, skill.body))
  }

  for (const workflow of WORKFLOWS) {
    await write(join(CLAUDE, 'workflows', `${workflow.slug}.json`), json({
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps.map((step, i) => ({ id: `step-${i + 1}`, ...step })),
      createdAt: new Date(NOW - workflow.createdAgo).toISOString(),
      lastRunAt: new Date(NOW - workflow.lastRunAgo).toISOString(),
    }))
  }
  log(`${WORKFLOWS.length} workflows`)

  // ---- a marketplace, so the plugin surface is not empty
  const installed = { version: 2, plugins: {} }
  for (const plugin of MARKETPLACE.plugins) {
    const installPath = join(CLAUDE, 'plugins', 'cache', MARKETPLACE.id, plugin.name, plugin.version)
    await write(join(installPath, '.claude-plugin', 'plugin.json'), json({
      name: plugin.name, version: plugin.version, description: plugin.description,
    }))
    for (const [file, command] of Object.entries(plugin.commands)) {
      await write(join(installPath, 'commands', file), frontmatter({ description: command.description }, command.body))
    }
    for (const [name, skill] of Object.entries(plugin.skills)) {
      await write(join(installPath, 'skills', name, 'SKILL.md'), frontmatter({ name, description: skill.description }, skill.body))
    }
    installed.plugins[`${plugin.name}@${MARKETPLACE.id}`] = [{
      scope: 'user', installPath, version: plugin.version,
      installedAt: new Date(NOW - 30 * DAY).toISOString(),
      lastUpdated: new Date(NOW - 5 * DAY).toISOString(),
    }]
  }
  await write(join(CLAUDE, 'plugins', 'installed_plugins.json'), json(installed))
  await write(join(CLAUDE, 'plugins', 'marketplaces', MARKETPLACE.id, '.claude-plugin', 'marketplace.json'), json({
    name: MARKETPLACE.id,
    owner: { name: 'Storefront Team' },
    plugins: MARKETPLACE.plugins.map(p => ({ name: p.name, source: `./${p.name}`, description: p.description })),
  }))
  log(`${MARKETPLACE.plugins.length} plugins, ${SKILLS.length} personal skills`)

  // ---- repository
  await mkdir(REPO, { recursive: true })
  await git(REPO, ['init', '-q', '-b', 'main'])
  await git(REPO, ['config', 'user.email', 'demo@storefront.test'])
  await git(REPO, ['config', 'user.name', 'Storefront Team'])
  for (const [index, message] of HISTORY.entries()) {
    const entries = Object.entries(REPO_FILES)
    for (const [path, contents] of entries.slice(0, Math.max(1, Math.ceil(((index + 1) / HISTORY.length) * entries.length)))) {
      await write(join(REPO, path), contents)
    }
    await git(REPO, ['add', '-A'])
    await git(REPO, ['commit', '-q', '-m', message])
  }
  await write(join(REPO, '.git', 'info', 'exclude'), '\n# Session workspaces created by agents-ui\n.worktrees/\n')
  const baseSha = (await git(REPO, ['rev-parse', 'HEAD'])).stdout.trim()
  log(`repository at ${REPO} (${HISTORY.length} commits)`)

  // ---- sessions with real worktrees
  const sessions = []
  const runs = []

  for (const [index, spec] of SESSIONS.entries()) {
    const id = `demo${index}${Math.random().toString(36).slice(2, 8)}`
    const branch = branchFor(spec.title, id)
    const worktreePath = join(REPO, '.worktrees', id)

    await git(REPO, ['worktree', 'add', '-q', '-b', branch, worktreePath, 'main'])

    for (const commit of spec.commits) {
      for (const [path, contents] of Object.entries(commit.files)) await write(join(worktreePath, path), contents)
      await git(worktreePath, ['add', '-A'])
      await git(worktreePath, ['commit', '-q', '-m', commit.message])
    }
    for (const [path, contents] of Object.entries(spec.uncommitted)) await write(join(worktreePath, path), contents)

    const runIds = []
    for (const [turnIndex, turn] of spec.turns.entries()) {
      const runId = `demo-s${index}t${turnIndex}`
      runs.push(buildRun({
        id: runId, kind: 'chat', title: spec.title, sessionId: id, projectDir: worktreePath,
        createdAt: NOW - (SESSIONS.length - index) * 3 * HOUR + turnIndex * 11 * MINUTE, ...turn,
      }))
      runIds.push(runId)
    }

    sessions.push({
      id, title: spec.title, repoDir: REPO, worktreePath, branch,
      baseBranch: 'main', baseSha, status: 'idle', runIds,
      createdAt: NOW - (SESSIONS.length - index) * 4 * HOUR,
      updatedAt: NOW - (SESSIONS.length - index) * 3 * HOUR,
    })
    log(`session: ${spec.title}`)
  }

  // ---- rituals
  const schedules = []
  for (const [index, ritual] of RITUALS.entries()) {
    const id = `demo-sched-${index}`
    const runId = `demo-r${index}`
    runs.push(buildRun({
      id: runId, kind: 'command', title: ritual.title, input: ritual.input,
      invocation: ritual.invocation, scheduleId: id, projectDir: REPO,
      createdAt: NOW - ritual.lastRunAgo, ...ritual.run,
    }))

    const { hour, minute, days } = ritual.recurrence
    const next = new Date(NOW)
    next.setDate(next.getDate() + 1)
    next.setHours(hour, minute, 0, 0)

    schedules.push({
      id, title: ritual.title, input: ritual.input, invocation: ritual.invocation,
      recurrence: { hour, minute, days }, permission: ritual.permission,
      allowRules: [], enabled: ritual.enabled, origin: ritual.origin,
      pluginName: ritual.pluginName, projectDir: REPO,
      createdAt: NOW - 20 * DAY, lastRunAt: NOW - ritual.lastRunAgo,
      lastRunId: runId, nextRunAt: next.getTime(),
    })
    log(`ritual: ${ritual.title}${ritual.enabled ? '' : ' (paused)'}`)
  }

  for (const [index, extra] of EXTRA_RUNS.entries()) {
    runs.push(buildRun({
      id: `demo-x${index}`, projectDir: REPO, createdAt: NOW - extra.ago, ...extra,
    }))
  }

  await write(join(APP, 'sessions.json'), json({ version: 1, sessions }))
  await write(join(APP, 'schedules.json'), json({ version: 1, schedules }))
  for (const run of runs) await write(join(APP, 'runs', `${run.id}.json`), json(run))
  log(`${runs.length} runs`)

  console.log('')
  log('run the app against it:')
  console.log(`\n    CLAUDE_DIR=${CLAUDE} PORT=3200 node .output/server/index.mjs\n`)
  log(`then select ${REPO} as the project folder`)
  log('remove everything with: node scripts/demo-data.mjs revert')
}

async function revert() {
  let removed = 0
  for (const path of [CLAUDE, REPO]) {
    if (existsSync(path)) {
      await rm(path, { recursive: true, force: true })
      log(`removed ${path}`)
      removed++
    }
  }
  if (!removed) log('nothing to remove')
  console.log('')
  log('your real ~/.claude was never touched by this script')
}

const command = process.argv[2]
try {
  if (command === 'seed') await seed()
  else if (command === 'revert') await revert()
  else {
    console.log('Usage: node scripts/demo-data.mjs <seed|revert>')
    process.exit(1)
  }
} catch (e) {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
}
