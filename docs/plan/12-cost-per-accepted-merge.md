# 12 · Cost per accepted merge, on a page

**Wave** 2 · **Depends on** 11 · **Hot file** the spend page / a new tab on it
**Done when** one page answers "what did the work that actually shipped cost", broken down
by ritual, agent, model and repository, for a window you choose.

## Why

The spend chart answers what a day cost, a day late. This answers the question the
cost-control literature keeps asking and no orchestrator ships: cost per accepted outcome.
It is also the number that gets a bad ritual deleted, which is why it belongs on a page and
not in a report nobody opens.

## Before you start

Unit 11 shipped the join and recorded two gaps in its own brief. Read
`docs/plan/11-outcome-join.md` under `## Findings` first — both land on this page:

- **`RunSummary` has no `model` and no `projectDir`**, so grouping by model or repository
  needs full run records (`outcomeTurnOf` takes them) or two new fields on `summarize`, which
  six surfaces read. Choose one, deliberately, and say which in the comment.
- **Whether a turn changed a file is recovered from the event log.** It undercounts turns that
  edited through `Bash`, and a month of it means opening every run file. If the window
  selector makes that too slow, the fix is a cache or a recorded field — not a shorter window
  chosen quietly.

## Build

- Read brief 11's util and use it. If a number is missing, extend the util with tests, not
  the page with arithmetic.
- Headline: spend per landing this week, and the same figure last week.
- A table under it: by ritual, by agent, by model, by repository — spend, landings, spend
  per landing, and spend that produced nothing.
- Mark indicative numbers as indicative, in the page, once. Rate-limited subscriptions make
  dollars notional and the page should say so rather than implying precision.
- Tabular numerals, right-aligned money, and it must read correctly on a machine with two
  landings as well as two hundred.

## Acceptance

- `make check` green.
- By hand: the headline agrees with the History tab for the same window. If it does not,
  the join is wrong, not the page.

## Out of scope

Per-person attribution — that arrives with identity in brief 17.

## Findings

- **There is no spend page.** `app/components/SpendSummary.vue` exists and nothing
  renders it; the only reader of `/api/spend` in the whole app is `settings.vue`,
  which asks for one day of it to check a budget. The nearest thing to a spend
  surface is the night-shift strip on the **History** tab of `/work`. So this
  landed as a third tab there — Start · History · **Ledger** — which is also what
  makes the acceptance check one click rather than two pages. `useWorkPane`'s
  union grew a third value; nothing else on the page or the rail needed changing,
  because every block on it is already gated on `start` or `history`.
- **Unit 11's first gap, decided: read run records.** Added
  `runRecordsSince` to `server/utils/runStore.ts` rather than putting `model` and
  `projectDir` on `summarize`. Two reasons, and the second is the one that
  settles it: `RunSummary` is read by six surfaces, and the *other* gap —
  whether a turn changed a file — is recovered from the event log, which no
  summary field was going to carry. One of the two forced records regardless, so
  adding fields would have bought nothing and widened a shared type.
- **Unit 11's second gap: no cache, and here is why.** Reading records is no more
  I/O than `runsSince` — `collectRuns` opens and parses every run file either
  way, events included. What genuinely grows is *memory*: a window's event logs
  are held at once while `outcomeTurnOf` walks them. So the window is a chosen
  count of whole days (7 / 14 / 30 offered, hard cap 90 in `MAX_LEDGER_DAYS`)
  rather than "all time", and the choice is in the page where the reader makes
  it, not hidden. If the 30-day window ever becomes slow, the fix is
  `changedFiles` written onto the run at the end of the turn, which would let the
  ledger read summaries and stop touching event logs at all.
- **The current window runs short by whatever is left of today**, and the one
  before it is seven whole days. That asymmetry is why the headline is a *ratio*
  and not a total: "spent this week against spent last week" would report a fall
  every morning. Tested, and the header says "today included".
- **"Spend that produced nothing" had to be defined, and the obvious reading was
  wrong.** `abandonedCostUsd` alone reports `$0.00` against a ritual that has run
  nightly for a month and merged nothing — a ritual's turns belong to no session,
  so they are `unattributed`, not `abandoned`. The column is therefore
  `abandoned + unattributed`, exported as `unmergedCostUsd`, and open sessions
  are a separate column: unresolved is not lost, and counting it as loss would
  make every busy Friday look like a write-off. The page says both in words.
- **The ledger and the spend chart disagree by one detail, on purpose.**
  `/api/spend` buckets a run by `createdAt`; the ledger places a turn at
  `startedAt ?? createdAt`, because runs queue per repository and that is when
  the money was spent. A run asked for before midnight that started after it
  therefore falls in different windows for the two surfaces. Left alone —
  `summarizeSpend` is brief 12's neighbour, not its file — but it is the one way
  the acceptance check can differ without the join being wrong.
- **The by-hand acceptance check could not be done by hand.** No browser and no
  background server in an unattended session, so it is mechanised instead:
  `test/ledgerEndpoint.test.ts` points `/api/ledger` and `/api/spend` at one
  seeded run log and requires the totals to reconcile —
  `current.costUsd + current.side.costUsd === spend.total`, over the same seven
  days, starting on the same day. They reconcile rather than match because the
  chart folds session summaries into its total and the ledger keeps them beside
  it.
- **`formatCost` is not usable in a money column.** It returns `null` for zero
  and `<$0.01` under a cent, both of which break a column meant to be compared
  down. `CostLedger.vue` formats its own at two fixed places instead; the shared
  helper is right for the prose it was written for and was left alone.
