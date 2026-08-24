# 32 · Race the agents

**Wave** alone — it adds a field to `Session` and a control to the Start composer
**Depends on** 31 (the provider seam)
**Hot files** `app/utils/race.ts`, `server/api/sessions/race.post.ts`, `app/pages/work.vue`,
`app/pages/sessions/[id].vue`
**Done when** one instruction starts a session per installed agent, each in its own worktree
running its own `make check`, and the page says which of them passed.

## Why

This is the thing unit 31 was cut for, and unit 31 said so: *"three sessions racing the same
brief on three different agents, in three worktrees, gated on the same `make check`, with the
train landing whichever one passed. None of the three CLIs can do that for itself. This app
already does the hard half."*

It turned out to already do rather more than half. Checks run themselves after any turn that
changed files, detached, and land on `session.check` — so "gated on the same `make check`" needed
no work at all. The worktrees, the branch naming, the merge train and the ledger were all
already per-session and already provider-blind. What was missing was one sentence: that these N
sessions are one question rather than N unrelated pieces of work.

So the unit is small, and deliberately so.

## Built

**1. `Session.raceId`.** Shared by every entrant and by nothing else, so it is both the grouping
and the answer to "why are there three of these". Absent on every ordinary session.

The entrants are otherwise completely independent — own worktree, branch, turns, checks, record.
**A race is a way of starting work and a way of reading it; it is deliberately not a thing that
runs.** Every mechanism it would need already exists per session, and a coordinator would be a
second place for a session to get stuck.

**2. `POST /api/sessions/race`.** `batch.post.ts` with the axes swapped: that one is N
instructions on one agent, this is one instruction on N agents. Narrows the asked-for agents to
those actually installed rather than refusing for naming a missing one, refuses below two, and
titles each entrant for its agent so a list of N rows is navigable.

**3. `app/utils/race.ts`** — the standings, and the only part with decisions in it.

**Nothing here picks a winner.** It sorts entrants and stops. Two passing entrants is two
answers, and a tool that landed the first one to go green would be choosing on arrival order and
calling it a verdict. What it does do is make the useless outcomes unmistakable — everybody
failed, nobody committed anything — because those are what N separate rows in a list hide.

**4. The controls.** A "Race the agents" checkbox beside the agent picker on Start, shown only
where more than one agent is installed, saying the cost before the button is pressed. A band on
the session page listing the entrants with their standings, each linking to its own page.

## Findings

- **`candidates` is populated while the race is still open**, and the contract had to be changed
  to say so. The first draft documented it as empty until decided; a test caught the mismatch.
  An entrant that has already passed *is* landable, and making somebody wait for the slowest
  agent before they may take a green diff would be the tool insisting on a comparison they did
  not ask to finish. So the two fields answer different questions: `candidates` is what could be
  landed, `outcome` is whether waiting longer is worth it.
- **A stale verdict is never a pass.** It describes code that has since changed, and reading it
  as green would offer to land work nothing has checked — the one mistake in this module that
  could put broken code in a base branch. It reads as `unknown`.
- **`landed` outranks a later red check.** Once the commits are in the base the question the race
  asked has been answered; a failing verdict about the workspace afterwards is a fact about the
  workspace.
- **The race checkbox is deliberately not remembered**, unlike the trust level beside it.
  Racing costs a session per agent for one piece of work, so a setting that quietly stayed on
  would turn every instruction typed afterwards into N of them.
- **Images go to every entrant.** They are being asked the same question, and one that could not
  see the screenshot is not a comparison. The first draft dropped them silently.
- **A race is N times the spend and no limit knows that.** `checkBudget` is consulted once, the
  same call a single session gets. Combined with unit 31's finding that the dollar caps cannot
  see a Cursor session at all, a race of Claude and Cursor is a piece of work whose cost the
  ledger under-reports twice over. The page says the multiplier before the button; nothing
  enforces it.

## By hand

A real two-agent race, driven in-process against a scratch repository with a genuine failing
test — an off-by-one in a `sum()` loop bound, `make check` running `node test.js`:

```
started claude: mt7l6c5uln8w on fix-the-off-by-one-claude-mt7l6c5uln8w
started cursor: mt7l6c90lk4e on fix-the-off-by-one-cursor-mt7l6c90lk4e
[0.3m] open     — 0 of 2 finished, the rest still working.
[0.5m] open     — 1 of 2 finished  (claude passed, cursor still working)
[1.0m] decided  — 2 of 2 passed — read the diffs and pick one.
```

The behaviour that mattered held: Claude passed at 30 seconds and the race correctly stayed
**open** rather than declaring it won, because Cursor was still going.

**Both agents produced the byte-identical diff**, differing only in commit message. That is the
honest result and it is worth stating plainly: on an unambiguous one-line bug a race is wasted
money, because there is only one right answer. A race earns its cost on work where the approach
is genuinely open — a refactor, an API shape, a performance fix — and not on a bug with one
correct fix. Nothing in the UI says that yet.

**What remains unproven:** the controls. The checkbox on Start and the band on the session page
have been typechecked and read, not pressed — the race above was driven past the HTTP layer and
past the browser. Somebody has to open Start, tick the box, and land one of the two.

## Out of scope

- **Landing the winner and closing the losers in one action.** Tempting, and left out: closing
  is now available per row from the rail with the branch kept where there are commits, and one
  button that resolves a race by destroying N−1 workspaces deserves its own thought.
- **Comparing the diffs side by side.** The band links to each entrant and the diff pane already
  exists per session. A real comparison view is its own unit.
- **Racing a ritual.** A schedule has a `provider` and could have entrants, but a race nobody is
  awake to read is N times the spend for a diff that waits until morning either way.
- **Codex.** Not installed on this machine. The race is N-way over whatever is installed, so it
  needs no change to include it.
