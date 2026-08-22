# The implementation plan

Thirty units, each one Claude Code session's worth of work, each with a gate it either
passes or does not. Written to be executed without supervision: read
[`CONTRACT.md`](CONTRACT.md) once, then hand out briefs.

The sequence comes from [the roadmap](https://claude.ai/code/artifact/074f1d7b-b6bd-44fb-b59d-dda9a5eabbe8),
which came from a competitive scan on 22 August 2026. Seven phases, no fan-out — it was cut
on running cost.

## How to run one

```bash
git worktree add .worktrees/plan-01 -b plan/01-diff-comments main
cd .worktrees/plan-01 && mkdir -p node_modules && bun run prepare
claude --permission-mode acceptEdits \
  "Implement docs/plan/01-diff-comments-to-turn.md end to end. Follow docs/plan/CONTRACT.md."
```

One worktree per unit, so several run at once without fighting over files. Start with
[`00-machine-setup.md`](00-machine-setup.md) — permissions, a repo `CLAUDE.md`, and a green
baseline. Skip it and the first wave stops at a permission prompt nobody is there to answer.

## Waves, and why they exist

Units inside a wave touch **disjoint hot files**, so they can run concurrently and merge in
any order. Across waves they cannot. `app/pages/sessions/[id].vue` is 89K and sits under
four separate units — that file is the reason this plan has waves at all rather than a list.

| Wave | Units | Hot files, one per unit |
| --- | --- | --- |
| 0 | 00 | by hand, before anything |
| 1 | 01 · 05 · 10 · 11 · 30 | session page · new · README · new · roadmap |
| 2 | 03 · 06 · 12 · 21 | sessionTurn · land · spend page · new |
| 3 | 02 · 07 · 13 · 14 | session page · land · schedules · new |
| 4 | 04 · 08 · 15 | preview · land · checks + merge dialog |
| 5 | 09 · 22 | land · merge dialog |
| 6 | 17 | records, everywhere — runs alone on purpose |
| 7 | 16 · 18 · 23 | stores · new · train |
| 8 | 19 · 20 · 24 · 25 | digest · docs · gitOps · new |
| 9 | 26 · 27 · 28 · 29 | proposals · new page · export · wizard |

## After each wave, before the next

1. **Merge in unit order**, lowest number first, re-running checks after each merge.
2. **Read every `## Findings` and `## Blocked`** the sessions appended to their briefs. That
   is the only report they were asked to write, and it is where the next wave's surprises are.
3. **`make check` on `main`.** A red baseline makes the next wave's verdicts meaningless.
4. A unit that came back blocked stays blocked. Do not re-run it hoping; fix the cause or cut it.

## The units

| # | Unit | Wave | Depends on |
| --- | --- | --- | --- |
| 00 | Set up for unattended sessions | 0 | — |
| 01 | Comment on your own session diff | 1 | — |
| 02 | Open this worktree in an editor | 3 | — |
| 03 | Steer a turn instead of stopping it | 2 | — |
| 04 | Point at the thing in Preview | 4 | — |
| 05 | Be an MCP server, not just a client | 1 | — |
| 06 | An issue band on Land | 2 | — |
| 07 | The issue row becomes a session | 3 | 06 |
| 08 | Linear as a second source | 4 | 06, 07 |
| 09 | One comment back, and nothing else | 5 | 07 |
| 10 | The hand-off convention, documented | 1 | — |
| 11 | The outcome join | 1 | — |
| 12 | Cost per accepted merge, on a page | 2 | 11 |
| 13 | Does this ritual earn its keep | 3 | 11 |
| 14 | When landed work gets reverted | 3 | 11 |
| 15 | Which check is merely flaky | 4 | — |
| 16 | Mine and ours | 7 | — |
| 17 | Who did this | 6 | 11 |
| 18 | The shared ledger | 7 | 11, 17 |
| 19 | The team digest | 8 | 18 |
| 20 | The always-on runner | 8 | 16 |
| 21 | A symbol map per worktree | 2 | — |
| 22 | The warning before the merge | 5 | 21 |
| 23 | A train that orders itself | 7 | 22 |
| 24 | Bring the base in, for all of them | 8 | 23 |
| 25 | The three signals | 8 | 14 |
| 26 | Rules that learn, as a diff | 9 | 25 |
| 27 | A board anyone can read | 9 | 11, 17 |
| 28 | The audit export | 9 | 11, 17 |
| 29 | A second engineer's first hour | 9 | 16, 18 |
| 30 | Reconcile the roadmap's premise | 1 | — |

## Two honest caveats

**Depth is graduated.** Units 01–15 name real files, real functions and real edge cases, and
are executable as written. Units 16–29 name the right modules and the right decisions, but by
the time a session reaches them the code will have moved — expect to re-read the brief against
the tree and sharpen it before handing it out.

**Three units can come back blocked and that is correct.** 03 depends on what the Agent SDK
version in `package.json` actually allows mid-query; 08 needs a Linear credential; 20 is a
document that can only be finished by following it on a second machine. Each says so, and
each is told to stop rather than invent.
