# Roadmap

Third pass, August 2026, written the week 0.2.0 went to npm. Against Claude Code 2.1.224
and the Desktop redesign of April 2026. The public version is
[launch/roadmap-issue.md](launch/roadmap-issue.md) and should be regenerated from this
whenever something here moves.

## Where this actually is

The absorb-the-workbench cycle finished. All five items shipped — a file editor with
line numbers and colour, a real shell on a pty, the project's dev server running in the
page, rewind guarded by `baseSha`, and one pane at a time so the four of them fit. Two
more landed on top: how much a session is trusted before it starts, and telling one event
firing from another. Eleven versions went out between the 4th and the 10th, ending at
0.2.0.

**Published is not launched, and the numbers say so plainly.** npm reports ~1,500
downloads, which looks like an audience until the curve is put beside the publish log:

| Day | Publishes | Downloads |
| --- | --- | --- |
| Aug 4 | 2 | 208 |
| Aug 5 | 1 | 213 |
| Aug 6 | 5 | 666 |
| Aug 7 | 2 | 311 |
| Aug 8 | 0 | 61 |
| Aug 9 | 0 | 17 |

About 130 downloads per publish, decaying to noise the day publishing stopped. That is
registry mirrors and security scanners doing their rounds, not people installing a thing.
Everything else agrees: no new star since the 3rd — *before* the first publish — fourteen
unique repo visitors in fourteen days, no issue opened by anyone, and no comment on the
pinned roadmap issue.

So the second pass's diagnosis survives intact, and now it has a number attached: the
build is ahead of the evidence, and five more features have since been chosen the same
way the four before them were. Six of the eight blocking items in
[launch/CHECKLIST.md](launch/CHECKLIST.md) are still unchecked.

---

## What is actually blocking the launch

Not the checklist. The checklist is a week of unglamorous work and none of it is hard.

The blocker is the comment everyone expects in the first ten replies: **"this is Claude
Code and Claude Desktop with a web page on it."** Going into a Show HN without a true
answer to that is what makes the thread go badly, and the honest position today is that
the answer exists but the pitch buries it.

### Concede the part that is true

Claude Code runs on a cron. Routines fire in Anthropic's cloud. Desktop has sessions on
worktrees, a diff viewer, archive-on-merge, and a workbench that is straightforwardly
better than this one. Anyone claiming otherwise gets corrected in public, deservedly.

### The answer, stated once

Starting an agent is the easy half. Everything here is the other half — what happens
after it runs, when nobody is watching:

- A run that fails your test suite does not merge. The verdict expires when the base
  moves, so a pass from an hour ago does not count for code that changed underneath it.
- A run that fails its checks fixes itself, up to a limit you set, and then stops.
- A ritual that has failed `GIVE_UP_AFTER` mornings running turns itself off instead of
  failing every morning forever.
- Several finished branches land in an order that accounts for each other, re-checked as
  the base moves under them.
- A daily spend cap skips the work rather than billing you for it, and work is held back
  near the rate limit rather than burning the last of it unattended.
- An unattended run reaches only the hosts on a list you chose, and says which one it was
  refused.

None of those are a nicer way to start an agent. They are the layer that decides whether
what the agent did should land — a gate, a governor, and a health record. That layer is
what you end up writing by hand once a cron job has merged something red at 3am.

Draft for the reply, to be reused in the posts:

> Yes — you can put Claude Code on a cron, and Desktop gives you sessions on worktrees. I
> ran it that way for months. What I kept hand-rolling was everything after: a run that
> fails its own tests shouldn't merge, a pass from before the base moved shouldn't count,
> a job that's failed three mornings running should stop rather than fail every morning
> forever, and none of it should quietly spend a day's budget while I'm asleep. That's
> what this is. Not a nicer way to start an agent — the part that decides whether what it
> did should land.

### Why the current pitch invites the objection

The README leads with *"Leave Claude Code running — work that fires on a schedule."* That
is the single row where the comparison is lost on the merits: Routines genuinely fire at
08:00 in the cloud, and here the deployment is a laptop that is shut. Leading with the
timer picks the one fight that cannot be won, and buries six rows that cannot be answered
at all.

**The pitch should lead with the gate and the governor, and let the schedule be a detail.**
Not "it runs at 08:00" but "it runs your tests before anything merges, and stops when it
has clearly broken". Same product, no promise the hardware cannot keep.

---

## Now — build the answer, then launch

The next cycle has one purpose: make the column Desktop does not have complete enough
that the objection answers itself, and close the two holes where a first demo falls over.
Ordered.

### ~~1. The PR after the merge~~ — shipped

Watch it, react to red CI, land it when green. The loop closing end to end — event fires,
work happens, checks gate it, PR opens, CI goes red, the fix happens, it lands green,
nobody was watching. It compounds rather than adding a surface: event triggers, the check
queue, expiring verdicts and the lander were all already here.

**Landing is opted into separately from watching, every time.** Fixing red CI pushes to a
branch that is already yours and is undone by resetting it. Merging is the one action in
this app that other people can see and that nothing here can take back, so it is never
inherited from switching watching on, and the checkbox resets each time the dialog opens.
A checkbox that remembers "yes" is how somebody merges something they did not mean to.

**Silence is not success.** A pull request whose rollup reports nothing has passed
nothing, and is never landed on that basis — otherwise the merge gate this product is
built around would quietly stop applying to the one merge anybody else can see. It is
given five minutes first, because Actions takes a moment to queue and watching a pull
request the instant it opens is the normal case, not the exception.

Driven by polling on the scheduler's existing event tick, with no hook into the turn
lifecycle: a fix turn is detached, so the alternative is a completion callback that has to
survive the process stopping mid-turn. Asking "is this session still busy?" every two
minutes needs nothing to survive anything. It rides the same timer as the event poll but
is deliberately not awaited behind it — `pollEventsOnce` can sit for the ten-minute retry
delay, which is long enough that a pull request going green would go unnoticed while an
unrelated ritual finished.

**The working rule paid for itself again, and this time it caught a shipped bug rather
than a design one.** `gh pr view --json statusCheckRollup` on this repository's own pull
request came back with *two* `CheckRun` entries both named `build`, from workflow runs four
hours apart, against a single head commit — a re-run leaves the earlier attempt in the
list. Read flat, any failing row makes the pull request failing, so a check that failed and
was re-run green would stay red for as long as anyone watched it: the watcher would hand
the same already-fixed failure back three times, spend every attempt it had, and give up on
a pull request that was passing throughout. The rollup is now reduced to the latest result
per check name. One cheap probe, and it was the difference between the feature working and
the feature confidently doing the wrong thing.

Two smaller things the same review caught before they shipped: `gh pr merge
--delete-branch` exits non-zero *after having merged*, because the branch is checked out in
the session's worktree and git refuses to delete it — so a successful landing would have
been reported as refused. And a branch whose pull request was opened by hand has no
upstream, which made `@{upstream}..HEAD` fail and read as "the turn committed nothing".

### ~~2. Ritual chains~~ — shipped

Triage → fix → verify → open a PR as one unit, with one health record. A ritual can now be
an ordered list of instructions instead of one, each step told what the last produced,
stopping at the first that does not work — verifying a fix that failed is a way to spend
money confirming it.

**The steps are separate runs; the firing is one thing.** Each step gets its own
transcript, its own cost and its own row, because that is where the detail is useful. They
carry a `chainId`, and one collapse turns them back into a single firing wherever a
*judgement* is made. That split is the whole design, and it is load-bearing in two places
that turn out to be the same place:

- **The failing streak.** `GIVE_UP_AFTER` is three, counted in mornings. Without the
  collapse a three-step chain failing once contributes three failures, and the ritual turns
  itself off after a single bad night — the precise behaviour chains exist to avoid.
- **The morning digest.** One thing happening overnight was about to be three things to
  read about it, which was the other half of the complaint.

Three defects found reviewing it, all of them the same shape — somewhere a chain quietly
went back to being N things:

- **`listRunsBySchedule` capped at ten *runs*.** A six-step chain would have given barely
  one firing of history, and `shouldGiveUp` needs three consecutive bad ones — so a chain
  long enough would never have been turned off at all. It counts firings now.
- **What a step was refused was nearly lost.** The digest offers to grant the rules a
  blocked run asked for; taking them from the deciding step alone would drop a rule asked
  for by step one, so the offer would never appear for the thing that actually blocked.
  Unioned across the firing.
- **A chain trimmed to one step kept its old steps.** `normalizeSteps` returning nothing
  read as "absent, keep what is stored", so the saved record disagreed with what had just
  been sent. Present-but-degenerate now clears.

The row says how many steps a ritual has, because one firing of a chain is several agent
invocations and that is the most expensive fact on the row.

### ~~3. More event kinds~~ — two of three shipped

Issue labelled and review requested. Both fit the deployment better than the clock does:
an event fires whenever the machine is awake, so there is no window to miss.

**They needed a different source, and that was the whole design.** The first two triggers
list things that *exist* — open pull requests, finished workflow runs — and key the cursor
on a number GitHub hands out in order. "Labelled" is not a property of an issue. It is
something done to one, possibly long after it was opened and possibly more than once, so
listing issues cannot express it: an old issue labelled today has a low number, and a
high-water mark on issue numbers steps straight past it. Keying on `updatedAt` instead
would have fired on every comment and edit as well, which is a trigger that does not do
what its own sentence says.

`repos/{owner}/{repo}/issues/events` is the event log itself — a monotonically increasing
`id` per entry, and the kind of thing that happened on each. Both new kinds come from one
request, and the cursor works unchanged.

**The third one is not built, and the reason is a payload fact.** A `mentioned` event
exists in that log, and it has **no field saying who was mentioned** — `actor` is whoever
wrote the comment. Confirmed against a hundred real events from a busy public repository,
where all three kinds appear. So the endpoint cannot answer "mentions *me*"; a trigger
built on it would fire on every mention of anybody in the repository, which is a
different and much noisier feature wearing the wrong name. Doing it properly means the
search API or the notifications feed, neither of which has a monotonic id, so it needs a
cursor design of its own rather than a fourth branch in this one. Left undone deliberately
rather than shipped as something that would look right in a menu and be wrong in use.

The working rule earned its keep for the third cycle running, and this time it changed
what got built rather than how: **look at the real output before designing around it.**
An afternoon's assumption would have produced a mentions trigger nobody could rely on.

### 4. The event lookback is a silent cap

`LOOKBACK = 50` in `eventTriggers.ts` bounds both `pr list` and `run list`. Fifty covers a
weekend and does not cover a fortnight, and past it the difference is skipped without a
word. This is the same class of bug as the silently-missed ritual that was fixed last
cycle, and it deserves the same treatment: a poll that cannot reach its own cursor says so
rather than pretending it caught up. It is a debt, not a bet — nobody needs to ask for it.

### 5. Laptop sleep, decided rather than deferred

`CATCH_UP_WINDOW_MS` is two hours. Past that a due ritual is marked missed and reported in
*while you were away*, which was last cycle's fix and was the right one — the silence was
the bug. The remaining decision is whether an overdue ritual should *run* on wake rather
than only be reported, per ritual and opt-in.

It is a real trade and both sides are defensible: a briefing generated at 14:00 about the
morning is worse than nothing, while a triage run that is six hours late is still worth
having. Opt-in per ritual is the answer, with the run labelled late so nothing pretends it
happened on time. Settle it before the launch drafts are rewritten, because it is the
difference between conceding the row and answering it.

### 6. The cold machine

The one blocking checklist item with teeth. A container with no global npm cache, no
`~/.claude`, and no signed-in Claude Code, checking that the setup wizard says something
useful rather than dead-ending. Nothing kills a Show HN faster than the install failing in
the first ten comments, and this cannot be tested on a machine that already works.

### Then the rest of the checklist, then post

Hero GIF, screenshots, social preview, repo name, rewritten drafts. Mechanical once the
above is true, and worth doing in that order — the drafts cannot be written until the
answer above is built and the sleep decision is made.

---

## Deliberately not doing: workbench depth

Find-in-file, bracket matching, a proper diff viewer, arrangeable panes. The README
concedes Desktop wins here and it is not close, and the temptation after finishing the
absorb cycle is to close that gap.

**Declining is the answer to the objection, not a retreat from it.** Parity-chasing on the
workbench is precisely how you become the second-best Desktop, built by one person,
arriving late — and it spends the cycle making the "it's just Desktop" comment *more*
true. The absorb bet was always narrow: you never have to leave a session's workspace to
finish its work. That bar is met. Editing one line and re-running the checks works today.

It comes back if somebody who is actually using this says the editor is why they left.

---

## After the launch — bets, and what would settle each

Unchanged from the second pass and still deliberately unordered, minus the three promoted
above. There is no telemetry here and there never will be, so the evidence is what people
say in issues and threads.

| Bet | Promote it when somebody says |
| --- | --- |
| **Event runs that are legible** — partially addressed; each firing now says which event it was | "I still can't tell these three runs apart" |
| **Configuration that travels through git** — rituals and checks committed to the repo | Anyone describing a second person in the same repo. The entire team story, and it is a file format, not a server |
| **Landing without colliding** — teammates' open branches, not only our own sessions | Same signal, arriving later |
| **Which rituals earn their cost** | "I don't know if this is worth what it spends" |

One debt still demoted: **storage that survives concurrency.** Flat JSON remains the
permanent design for one person on one machine. It comes back if the run queue actually
corrupts it, and not before.

---

## Shipped

Parallel sessions on worktrees · project checks gating merges · sessions that repair their
own failing checks · verdicts that expire when the base moves · ordered landing of several
finished sessions · rituals that retry once and stop when they have clearly broken ·
sandboxed runs that name the host they were refused · rituals that fire when a PR opens or
CI goes red · the rate limit shown beside the spend and enforced against unattended work ·
a skipped ritual saying so · permission handling for unattended runs · spend tracking and
hard limits · multi-repository projects · MCP management · GitHub skill import ·
marketplace and plugin install · workflow builder · relationship graph · backups ·
**editing a file without leaving the session** · **a real shell in the workspace** ·
**running the session's app and looking at it** · **rewind, guarded at the branch point** ·
**one pane at a time** · **choosing how far a session is trusted before it starts** ·
**following the pull request after it is opened — fixing red CI and landing it when green** ·
**rituals that are a chain of steps, counted as one firing** · **rituals that fire when an
issue is labelled or a review is requested** · **picking a branch or pull request from what
exists, rather than typing it**.

The working rule from last cycle held again and is worth keeping: **for anything that
reads somebody else's output, look at the real output before designing around it.** Add
one from this cycle: **a metric that only moves when you act is measuring you, not your
users** — the download curve tracked publishes, and reading it as demand would have made
the launch look finished.

## Still not planned

- **Mobile, remote access, authentication, hosted mode.** One person, one machine.
- **Webhooks.** Taking them means opening a port to the internet, which is a different
  product with a different threat model. Polling asks the same question from inside.
- **Non-Claude model backends.**
- **Telemetry.** Which is why the table above is written in sentences people might say
  rather than numbers nobody will ever see.
