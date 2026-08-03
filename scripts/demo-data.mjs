#!/usr/bin/env node
/**
 * Seed the app with realistic demo data, and take it back out again.
 *
 *   node scripts/demo-data.mjs seed     # create it
 *   node scripts/demo-data.mjs revert   # remove exactly what was created
 *
 * Everything created is recorded in a manifest, and `revert` removes only what
 * is listed there. It never rewrites your real sessions, rituals or runs — the
 * point is that this can be run against a machine with real work on it and
 * leave no trace afterwards.
 *
 * Sessions are created through the running app rather than written to disk, so
 * their worktrees, branches and git exclusions are genuinely correct: the diffs
 * and commit counts in the UI are real, not mocked numbers.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:3000'
const CLAUDE_DIR = process.env.CLAUDE_DIR || join(homedir(), '.claude')
const APP_DIR = join(CLAUDE_DIR, 'agents-ui')
const MANIFEST = join(APP_DIR, 'demo-manifest.json')
const REPO = process.env.DEMO_REPO || join(homedir(), 'workspaces', 'storefront-demo')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const log = (msg) => console.log(`  ${msg}`)

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const git = (cwd, args) => exec('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })

/** Atomic, and preserves every record that is not ours. */
async function rewriteSessions(mutate) {
  const path = join(APP_DIR, 'sessions.json')
  const file = JSON.parse(await readFile(path, 'utf-8'))
  file.sessions = mutate(file.sessions)
  const tmp = `${path}.demo.tmp`
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf-8')
  await rename(tmp, path)
}

// ---------------------------------------------------------------- demo repo

const REPO_FILES = {
  'README.md': `# Storefront

The customer-facing shop. Next.js on the front, Postgres behind an API layer.

## Running it

    pnpm install
    pnpm dev

## Layout

| Directory      | What lives there                        |
| -------------- | --------------------------------------- |
| \`src/app\`      | Routes and pages                        |
| \`src/lib\`      | Cart, pricing and catalogue logic       |
| \`src/server\`   | API handlers and database access        |
`,
  'package.json': JSON.stringify({
    name: 'storefront', version: '2.0.4', private: true,
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run' },
  }, null, 2) + '\n',
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

async function createRepo() {
  if (existsSync(REPO)) {
    throw new Error(`${REPO} already exists. Remove it first, or set DEMO_REPO to another path.`)
  }

  await mkdir(REPO, { recursive: true })
  await git(REPO, ['init', '-q', '-b', 'main'])
  await git(REPO, ['config', 'user.email', 'demo@storefront.test'])
  await git(REPO, ['config', 'user.name', 'Storefront Team'])

  // A little history, so branch comparisons and diffs have something to say.
  for (const [index, message] of HISTORY.entries()) {
    const entries = Object.entries(REPO_FILES)
    const slice = entries.slice(0, Math.max(1, Math.ceil(((index + 1) / HISTORY.length) * entries.length)))
    for (const [path, contents] of slice) {
      await mkdir(dirname(join(REPO, path)), { recursive: true })
      await writeFile(join(REPO, path), contents, 'utf-8')
    }
    await git(REPO, ['add', '-A'])
    await git(REPO, ['commit', '-q', '-m', message])
  }

  log(`repository at ${REPO} (${HISTORY.length} commits)`)
}

// ----------------------------------------------------------------- sessions

const SESSIONS = [
  {
    title: 'Add faceted search to the product list',
    // Committed and clean: this one is ready to merge.
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

// ------------------------------------------------------------------ rituals

const RITUALS = [
  {
    title: 'Morning briefing',
    input: '/hd:goodmorning',
    invocation: '/hd:goodmorning',
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
    input: '/hd:triage',
    invocation: '/hd:triage',
    recurrence: { hour: 9, minute: 30, days: [1, 2, 3, 4, 5] },
    permission: 'edits',
    origin: 'team',
    pluginName: 'hd',
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
    title: 'Weekly dependency audit',
    input: '/hd:audit-deps',
    invocation: '/hd:audit-deps',
    recurrence: { hour: 7, minute: 0, days: [1] },
    permission: 'readonly',
    origin: 'team',
    pluginName: 'hd',
    enabled: true,
    lastRunAgo: 3 * DAY,
    run: {
      status: 'completed',
      output: `Audited 84 direct dependencies.

**Worth acting on**

- \`undici\` 5.28.2 → **5.28.4**. Two advisories, both denial-of-service in the proxy path. We do not use the proxy path, so this is low urgency but a trivial bump.

**Majors available, none urgent**

| Package | Current | Latest | Notes |
| --- | --- | --- | --- |
| \`vitest\` | 1.6.0 | 2.1.4 | Config format changed |
| \`next\` | 14.2.3 | 15.0.2 | Needs a React 19 upgrade first |

Nothing unmaintained, nothing with a known-malicious version in the tree.`,
      costUsd: 0.0389, durationMs: 31_500,
      toolCalls: [
        { toolName: 'Bash', preview: 'pnpm audit --json — 2 advisories' },
        { toolName: 'Bash', preview: 'pnpm outdated --format json — 11 outdated' },
      ],
    },
  },
  {
    title: 'End-of-day summary',
    input: '/hd:endofday',
    invocation: '/hd:endofday',
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

// -------------------------------------------------------------------- runs

function buildRun({ id, title, input, output, createdAt, durationMs, costUsd, status = 'completed',
                    error, toolCalls = [], sessionId, scheduleId, invocation, kind = 'chat',
                    needsAttention, deniedTools, suggestedRules, projectDir }) {
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
    id, kind, title, input, invocation, projectDir,
    status,
    createdAt,
    startedAt: createdAt + 400,
    completedAt: createdAt + durationMs,
    output,
    error,
    stats: {
      usage: { input_tokens: 8_400 + Math.round(costUsd * 40_000), output_tokens: Math.round(output.length / 3.6) },
      costUsd, durationMs, numTurns: 1, model: 'claude-opus-5',
      permissionDenials: (deniedTools ?? []).map(toolName => ({ toolName })),
    },
    needsAttention, deniedTools, suggestedRules, scheduleId, sessionId,
    events,
  }
}

async function writeRun(run) {
  await mkdir(join(APP_DIR, 'runs'), { recursive: true })
  await writeFile(join(APP_DIR, 'runs', `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`, 'utf-8')
}

// -------------------------------------------------------------------- seed

async function seed() {
  if (existsSync(MANIFEST)) {
    throw new Error('Demo data is already seeded. Run `revert` first.')
  }

  log('checking the app is reachable…')
  await api('/api/backups')

  log('taking a backup first…')
  const backup = await api('/api/backups', { method: 'POST' })
  log(`backup: ${backup.name ?? 'already current'}`)

  await createRepo()

  const manifest = {
    createdAt: Date.now(),
    repo: REPO,
    backup: backup.name ?? null,
    sessionIds: [],
    scheduleIds: [],
    runIds: [],
  }

  const now = Date.now()

  // ---- sessions, created through the app so the git side is genuinely real
  for (const [index, spec] of SESSIONS.entries()) {
    const session = await api('/api/sessions', {
      method: 'POST',
      body: { title: spec.title, repoDir: REPO },
    })
    manifest.sessionIds.push(session.id)

    const wt = session.worktreePath
    for (const commit of spec.commits) {
      for (const [path, contents] of Object.entries(commit.files)) {
        await mkdir(dirname(join(wt, path)), { recursive: true })
        await writeFile(join(wt, path), contents, 'utf-8')
      }
      await git(wt, ['add', '-A'])
      await git(wt, ['commit', '-q', '-m', commit.message])
    }
    for (const [path, contents] of Object.entries(spec.uncommitted)) {
      await mkdir(dirname(join(wt, path)), { recursive: true })
      await writeFile(join(wt, path), contents, 'utf-8')
    }

    // Turns are runs; the session points at them in order.
    const runIds = []
    for (const [turnIndex, turn] of spec.turns.entries()) {
      const id = `demo-s${index}t${turnIndex}`
      const createdAt = now - (SESSIONS.length - index) * 3 * HOUR + turnIndex * 11 * MINUTE
      await writeRun(buildRun({
        id, kind: 'chat', title: spec.title, sessionId: session.id, projectDir: wt, createdAt, ...turn,
      }))
      runIds.push(id)
      manifest.runIds.push(id)
    }

    await rewriteSessions(sessions => sessions.map(s =>
      s.id === session.id ? { ...s, runIds, updatedAt: now - (SESSIONS.length - index) * 3 * HOUR } : s))

    log(`session: ${spec.title}`)
  }

  // ---- rituals
  for (const [index, ritual] of RITUALS.entries()) {
    const saved = await api('/api/schedules', {
      method: 'POST',
      body: {
        title: ritual.title, input: ritual.input, invocation: ritual.invocation,
        recurrence: ritual.recurrence, permission: ritual.permission,
        origin: ritual.origin, pluginName: ritual.pluginName, enabled: ritual.enabled,
        projectDir: REPO,
      },
    })
    manifest.scheduleIds.push(saved.id)

    const runId = `demo-r${index}`
    await writeRun(buildRun({
      id: runId, kind: 'command', title: ritual.title, input: ritual.input,
      invocation: ritual.invocation, scheduleId: saved.id, projectDir: REPO,
      createdAt: now - ritual.lastRunAgo, ...ritual.run,
    }))
    manifest.runIds.push(runId)

    log(`ritual: ${ritual.title}${ritual.enabled ? '' : ' (paused)'}`)
  }

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')

  console.log('')
  log(`${manifest.sessionIds.length} sessions, ${manifest.scheduleIds.length} rituals, ${manifest.runIds.length} runs`)
  log(`select ${REPO} in the sidebar to see the sessions`)
  log('remove it all with: node scripts/demo-data.mjs revert')
}

// ------------------------------------------------------------------ revert

async function revert() {
  if (!existsSync(MANIFEST)) {
    throw new Error('No demo manifest found — nothing was seeded, or it has already been reverted.')
  }

  const manifest = JSON.parse(await readFile(MANIFEST, 'utf-8'))
  let reachable = true
  try { await api('/api/backups') } catch { reachable = false }

  for (const id of manifest.sessionIds) {
    if (reachable) {
      // force: the demo worktrees deliberately carry uncommitted changes.
      try {
        await api(`/api/sessions/${encodeURIComponent(id)}?force=1`, { method: 'DELETE' })
        continue
      } catch { /* fall through to removing the record directly */ }
    }
    await rewriteSessions(sessions => sessions.filter(s => s.id !== id))
  }
  log(`removed ${manifest.sessionIds.length} sessions`)

  for (const id of manifest.scheduleIds) {
    if (reachable) {
      try { await api(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }) } catch { /* ignore */ }
    }
  }
  if (!reachable && manifest.scheduleIds.length) {
    const path = join(APP_DIR, 'schedules.json')
    const file = JSON.parse(await readFile(path, 'utf-8'))
    file.schedules = file.schedules.filter(s => !manifest.scheduleIds.includes(s.id))
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf-8')
  }
  log(`removed ${manifest.scheduleIds.length} rituals`)

  // Only ids this script created, so a real run is never deleted.
  const runsDir = join(APP_DIR, 'runs')
  if (existsSync(runsDir)) {
    const present = await readdir(runsDir)
    for (const id of manifest.runIds) {
      if (present.includes(`${id}.json`)) await rm(join(runsDir, `${id}.json`), { force: true })
    }
  }
  log(`removed ${manifest.runIds.length} runs`)

  if (manifest.repo && existsSync(manifest.repo)) {
    await rm(manifest.repo, { recursive: true, force: true })
    log(`removed ${manifest.repo}`)
  }

  await rm(MANIFEST, { force: true })
  console.log('')
  log('demo data removed; your own sessions, rituals and runs were not touched')
}

// -------------------------------------------------------------------- main

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
