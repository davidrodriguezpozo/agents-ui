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
