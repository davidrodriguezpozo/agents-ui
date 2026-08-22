# Roadmap

Sixth pass, 19 August 2026, written at 0.9.0 with a clean tree. Against Claude Code
2.1.235 and the CLI's own background-agent view, which arrived since the last pass.
Earlier passes are in git history; where one of them was wrong it is named here rather
than quietly dropped. **Amended 22 August 2026**, three days later, after a competitive
scan: the audience section was reopened, and the sequence this document used to imply now
lives in [`docs/plan/README.md`](plan/README.md).

## The audience is one engineer first, and now the team as well

**Amended 22 August 2026.** The fourth pass settled the audience at one person and no pass
since reopened it. The convention here is to name an earlier answer rather than drop it, so
it stays as it was written: *the tool exists to make one engineer, tech lead and manager
materially faster at those three jobs; public and MIT; if anyone else finds it useful that
is a bonus, not a plan.*

The first half of that survives. The primary user is still one person, and every finding
below is still about his machine. The bonus clause does not. A competitive scan on 22 August
re-read the table under "The competitive picture" and took the conclusion it had stopped
short of: background agents, a fleet in the terminal and cloud-hosted review of a pull
request are the solo argument, and they are native now. The case nothing else covers is the
one with a second engineer in it. So the decision taken that day was to build the team
plane, and the haddock team is a target the work is aimed at rather than a happy accident.

The difference is three things and deliberately no more. **Identity**: a run and a merge
record which person took them, read from git's own `user.name`, with no accounts and no
store of people. **Shared configuration**: rituals, checks and sandbox rules that belong to
the repository and arrive by pulling, with the machine's own still winning. **A shared
ledger**: append-only outcomes, one file per machine, carried on a branch, so team totals
are a read rather than a server. Nothing in that list needs a port open, a login, or
anything hosted — which is why "Still not planned" below barely moves.

**And the sequence lives elsewhere now.** It is [`docs/plan/README.md`](plan/README.md) —
thirty units in waves, each one session's work with a gate it passes or does not. The "Now"
list below is still this pass's findings in the order it costs to be wrong about them, which
is evidence and not a schedule. The premise and what the disk says are this document's job;
what gets built, and in what order, is the plan's. Where the two disagree, the plan is the
newer of them.

The method changed in this pass too, separately from any of that. The fifth pass's rule was
**the app's own alarms are a better backlog than this document**, and it paid: both alarms
it named turned out to be real defects. This pass went one layer down and read *the files on
disk* instead of the screens, and the reason to keep doing that is in the first section
below — this morning the app's own badge said **nothing needs you** while its queue held
four rows, its sessions held 20 GB of dead checkouts, and six of them were measuring the
wrong branch.

New rule, and this pass earned it the hard way: **a feature that is off is not shipped.**

---

## The census, which reorders everything else

Every store on this machine was read. Split by whether it is actually in use.

**In daily use, with evidence:**

- **Sessions on worktrees.** 46 records, 45 live, five repositories. The haddock ones
  are a day old and moving; `/hd:review <url>` and "address the comments on…" are what
  this app is mostly *for* now.
- **Batch start.** Nine sessions opened in one press in almaria (a persona each), seven
  in marketing, five in haddock. The parallel half of the thesis is real and is used.
- **Fleet.** Rebuilt three times in four days — poster → rows → ordinary page — because
  it is the screen the app is opened to.
- **The Morning brief.** Fired 08:47 today, `ok`, $1.95. Skipped Calendar and Gmail with
  the vendor reason named, and *reached* Notion. Exactly what the fifth pass predicted.
- **The gate.** 113 test files, 1,807 tests, green in 8.13s.

**Built, shipped, announced — and never switched on:**

| Surface | What the disk says |
| --- | --- |
| **The standing brief** | `brief.enabled: false`, and `DEFAULT_BRIEF` is `enabled: true`. It was turned off deliberately. Every run still starts cold — the thing the brief was built to stop |
| **The morning Slack message** | `digest-delivery.json` does not exist. Never configured, so never sent — and the reply-becomes-a-session path built on top of it has therefore never run once |
| **Ordered landing / the merge train** | Three landing runs, ever. All on 10–11 August, all `stopped`: a dirty main checkout, a restart mid-flight, and a session that had committed nothing. Zero completions. Work does land here — through a session merge or on github.com — just never through this |
| **Workflows** | Two run records, both `email-workflow`, neither with a real timestamp. Demo data |
| **Spend caps, self-repair, the quota brake** | `dailyCapUsd: 0`, `runCapUsd: 0`, `repairAttempts: 0`, `pauseOnQuotaWarning: false` — every one of them the default. $187.11 has gone through in 30 days, $23.51 of it today by 11:30, against no cap. On 18 August three consecutive attempts at the same work died — two of them on the session limit — with the brake available and off |

The last row is the honest one, and it is not "the user forgot". The stored preferences
differ from the defaults in exactly the four places he cared about — `maxTurns: 200`,
`maxConcurrentRuns: 5`, `/hd:review` and `/hd:address-pr` wired to the pull actions,
effort `high`. Everything he wanted, he set. The governors were never on by default and
have never once been needed.

**So the finding of this pass is about defaults, not features.** Five things the README
sells are off in the only installation that exists. Two of them — a spend cap and
self-repair — are rows in the comparison table with a ✅ beside them. That is not a lie,
but it is a claim no run on this machine has ever exercised.

---

## What the fifth pass got right, and what it did not look for

**Right, and worth keeping.** Following the alarms produced two real defects out of two
tries — the April pull request leading "Needs you" (`a7a2a8f`: elapsed time measures
urgency on a frozen session and apathy on a pull request) and the twelve strays offered
as twelve lost conversations (`03d414d`: `existsSync` read as an answer about recovery).
The skips band shipped and today's brief proves it: two sources skip every morning for
good, the third recovered, and the run says which is which.

**Right about the vendor boundary.** Unchanged and still not ours to move. Calendar,
Gmail and Drive remain connector-only because Google's authorisation server does not
implement dynamic client registration. Nothing to do; do not rediscover it.

**What it did not look for.** It called the gate-and-governor layer "infrastructure that
just needs to keep working", and the tests say it does. But it checked the layer by
reading the screens, and the screens were the wrong instrument: three of the four
defects below are invisible from every page in the app and were sitting in plain text in
`~/.claude/agents-ui` the whole time.

---

## Now

Ordered by what it costs to be wrong.

### 1. A session's record and its worktree disagree about which branch it is on

**Built the same afternoon, and it found a fifth consequence on the way.** The
measurement now follows the checkout: a drifted worktree is measured against
`origin/HEAD` rather than against a base HEAD is not on, and on the live sessions
that turned 2,317 files and 226 commits into 24 and 3 — while leaving alone the
session whose recorded base was already the trunk, which is the property that
makes it safe. Merging and landing refuse while the two disagree, checked *before*
anything commits: `commitFirst` would otherwise have committed a session's
leftovers onto a colleague's pull request branch and only then been refused. And
`landed` is no longer claimed for a drifted session — that was the fifth
consequence, and the ugliest, because `hasLanded` takes `ahead > 0` from the
checkout and `merged.has(branch)` from the record, so a branch nothing ever
committed to is trivially contained in its base and the session reads as finished.

Two things it must not treat as drift, both learned rather than assumed: a
worktree nobody has read yet, and a review session that is *deliberately* a
detached checkout of a pull request's head — where the record naming another
branch is the design, and "repairing" it would take that branch off the person
working on it.

That second exemption then turned up the sixth consequence, which is the mirror
image of the first: a review workspace's record is *correct*, so the drift check
passes it, and its commit count is healthy because those commits belong to the
pull request's author — so the merge preview offered to bring a colleague's branch
into the local base. Both refusals now come from one place, `mergeRefusal`, since
two write paths checking one and not the other is how the next one of these
arrives. **A drifted session must not merge the branch on record because the work
is elsewhere; a review session must not because the work is somebody else's.**


**Six of 46 sessions, including the one running right now.** Five `/hd:review` sessions
record `branch: hd-review-…-msy9…` while the checkout is actually on
`feat/langfuse-conciliation-bootstrap`, `…-port`, `…-cleanup`, `…-incident-emails`,
`…-product-categorization`. The agent checked out the pull request's branch inside the
worktree, which is the correct thing for it to have done, and nothing wrote it down.

What follows from it:

- Each of those five reports **2,226–2,317 changed files** and **214–226 commits ahead**.
  That is `4f27781` — the diff that handed you somebody else's commits as your own —
  arriving from the other side. That fix made the *base* honest; this is the *head*.
- `mergeSession` merges `session.branch` (`merge.ts:304`). Landing one of those rows
  merges the recorded branch, not the branch the work is on. The one action in this app
  other people can see, aimed at the wrong ref.

The worktree's own HEAD is the only thing that knows. Either follow it — the record
tracks the checkout, and the header says so when it moves — or refuse to land while the
two disagree. Following it is better: the sixth mismatch is the session running now,
already on `feat/langfuse-format-sanitizer` with 19 files and 2 commits, and it is
working perfectly. This is a normal pattern, not an error to prevent.

### 2. The front door under-reports, in two independent ways

`/api/attention` returned `needsYou: 0` at 11:29 this morning. At the same moment the
Now queue held a review request and three Slack threads, one of them a direct yes/no
question from 12 August.

- **The badge counts two of four sources.** `attention.get.ts` counts blocked sessions
  and failing rituals. The queue is built from four — attention, pulls, digest, inbox.
  The comment in that file argues at length that a badge contradicting the view it
  points at is worse than no badge; it was written when the queue had one source, and
  two were added after it.
- **The queue sees one project's pull requests.** It reads `/api/github/pulls`, which is
  scoped to the selected project. `wallPulls.ts` already reads all five, and its own
  docstring says why the scoped read is wrong here: *"a screen that shows the ones in
  whichever repository happens to be selected is a screen that hides three quarters of
  what is waiting while looking complete."* That argument was made about Fleet. It is
  twice as true of the page named Now.

Both are small. Both are in the one screen that has to stay trustworthy.

### 3. A quarter of every run this app has ever made was killed by a restart

**25 of 158 runs**, all with the same sentence: *"Interrupted — the server stopped while
this was running."* Twelve of them on 18 August alone — three sessions pushed forward
together at 09:43, again at 09:47, again at 09:59, when the third attempt hit the session
limit instead. Working on this app is the main way of losing work in it.

The recovery already exists on one side. `resumeInterruptedRituals` puts a ritual's clock
back to the occurrence it lost, and `closeInterruptedRuns` returns what it closed with a
comment saying precisely this: *"what was interrupted decides what should be picked up
again, and this is the only place that knows."* Only rituals read it. An interactive turn
is closed, its session set idle, and the instruction is gone — retype it.

The record carries `sdkSessionId` and the input. Resuming is a `resume` away. Two smaller
things ride along: interrupted runs record `costUsd: 0`, so the real spend on failure is
above the $10.97 the spend page can account for, and two runs died to *"your computer
went to sleep mid-response"*, which is the same class of loss with a different cause.

### 4. 20 GB of its own checkouts, and nothing in the app has ever mentioned a gigabyte

58 worktrees across the five managed projects, holding **47 GB**. The split matters, and
it is not the one the fifth pass would have guessed:

- **45 are this app's sessions: 20.6 GB.** Six haddock review sessions are 2.2–2.3 GB
  *each*, and 32 GB of the haddock total is `node_modules` — the per-worktree install that
  "make the workspace runnable first" performs. In a monorepo, a session costs two
  gigabytes before it has written a line.
- **13 were made by something else: 26.4 GB.** `authorization-gaps`, `i18n-broken-keys`,
  `ctid-data-loss-pattern` — the strays from `03d414d`, conventional branch names in this
  app's worktree directory, almost certainly `claude -w`. More than half the disk is
  therefore in checkouts this app only *lists*, under an Adopt button.
- Nothing here is in this repository beyond its own six dev sessions (3.5 GB).

34 sessions are older than five days. **19 of them are clean and empty** — precisely what
`verifyEmpty` was written to sweep, its docstring already describing this exact outcome
("after a week the list is mostly debris"). They are still there because the broom sits on
the *History* tab of `/work` and is scoped to the project you are currently in, so debris
accumulates in the four projects you are not in. The other 15 are `dirty`: a session that
made one edit and came to nothing is "somebody's work" forever, and holds a whole checkout
to prove it. The nine-persona batch in almaria is nine of those.

**The first clean-up happened by hand, with `du`, outside the app, on the afternoon this
was written.** That is the finding, and it is not the broom being missing — `close-empty`
exists and works. It is that no screen in the app has ever said a number in gigabytes, so
the only way to discover the cost was to go and measure it. A count of rows is not a cost.

So the work here is one honest figure in the places that already list these things — the
worktree panel, which offers to adopt 13 strays without saying what keeping them costs, and
the sessions list, where the broom should reach the projects you are not standing in.
**Batch start goes up to twenty in one press and there is no batch finish.**

And one thing worth measuring before building any of it: whether the per-worktree
`node_modules` has to be a copy at all. Twenty sessions on one monorepo was 32 GB of very
nearly identical dependencies — the recurring cost of the parallel model on the repository
it is used on most, which no amount of sweeping reclaims.

### 5. Then decide, per unused surface: default it on, or delete it

Not a maintenance chore — the census above is a decision list, and this app has already
proved it can take the decision. Cinema mode, the voice grammar, the act components, the
Live panel and the poster layout were all deleted rather than nursed, and every release
since has been better for it.

The two candidates for *on* are the standing brief and a spend cap, because both are free
and both are load-bearing in the README. The candidates for *deletion* are the merge train
(three attempts, zero completions, and landing already happens two other ways) and
workflows (never used once). The one thing this document cannot settle is **why the brief
was switched off** — its default is on, so that was a choice, and the answer decides
whether it gets fixed or removed. One question, worth asking before either.

---

## The competitive picture, re-checked locally

Read off `claude --help` at 2.1.235 rather than assumed:

| | Where it is now |
| --- | --- |
| `-w/--worktree`, `--tmux` | Native, and has been since February |
| `--bg`, `claude agents` | **New since the last pass** — background agents with a management view that lists sessions across directories and dispatches new ones. That is a fleet, in the terminal |
| `--cloud`, `--environment <id>` | Cloud sessions, now on self-hosted runners |
| `claude ultrareview` | Cloud-hosted multi-agent review of a branch or a pull request — overlapping the exact thing this app is mostly used for |

**Two of this app's original arguments are now partly native.** Parallel sessions on
worktrees was lost in April. The fleet view was lost this month. Neither loss changes what
to build, because neither was the reason it survived: what is still not native is *your*
test suite gating a merge, a verdict that expires when the base moves, several branches
landed in an order that accounts for each other, a per-project sandbox, spend and
rate-limit governors, and every repository at once on one screen. Those are the rows to be
judged on — and, per the census, three of them have never been switched on.

**This table is what reopened the audience on 22 August.** Every row above is a thing the
CLI now does for one person. Every row in the paragraph after it is a thing that gets
harder, not easier, once a second engineer is doing the same work in the same repository.
That asymmetry is the argument for the team plane, and it is why the audience section at the
top of this document no longer reads the way the fourth pass left it.

The README's comparison table still holds. Its **navigation** table does not: it names
Daily, Sessions, Activity, Workflows as the sections, and the app is Now, Work, Land,
Daily, Library, Fleet. Four releases of reorganisation went past it.

---

## Deliberately not doing

**Workbench depth.** Find-in-file, bracket matching, a diff viewer, arrangeable panes.
Desktop shipped all of it in April. The panes themselves stay, for the reason given two
passes ago: they close *this* app's loop.

**Chasing connector-only services into the unattended half.** Holding a Google refresh
token and renewing it hourly is a credential this app has never stored, to work around
somebody else's authorisation server. The honest answer stays: say which sources are
unattended and which are interactive.

**A second implementation of anything the wall already computes.** `verdictFor`,
`readPulls`, `sessionBadge`, `diffBase` — the pattern that keeps working is one owner per
fact and a type that stops divergence compiling. Item 2 above is a *reuse*, not a rewrite.

**The launch.** More stale than last pass, not less: the drafts lead with parallel
sessions, which is now a CLI flag, and the README's own section table describes a
navigation that no longer exists. Ten minutes of repo description, topics and Discussions
is the whole cost of leaving the door open.

---

## Bets, and what would settle each

| Bet | Promote it when |
| --- | --- |
| **A stale inbox is a degrading ritual** — skips and staleness counted across firings, said on the Daily page | Nearly there. The inbox was last read on **14 August**: its Slack rows are five days old, the oldest unanswered question in them is from the 12th, Notion still carries the query-limit error it hit on that read, and there is exactly **one** schedule on this machine. The next time a week-old row is acted on as though it were this morning's, this is due |
| **Inbox sources beyond Notion and Slack** | Demoted by the evidence. The problem is freshness of the two that exist, not breadth. Promote on the first morning you check something by hand *after* reading the queue — and only if the queue was current |
| **Configuration that travels through git** — rituals and checks committed to the repo | **Promoted 22 August 2026**, as the shared-configuration leg of the team plane. Still a file format, not a server |
| **Which rituals earn their cost** | One ritual, $1.95 a morning, attributable. Not urgent until there are several |
| **Landing without colliding** — teammates' branches, not only our own | The first landing that conflicts with something a colleague pushed. Pointed at a work monorepo with 23 worktrees on disk, this is closer than it was |
| **A session record that follows its checkout** rather than being corrected | If item 1 is fixed by refusing rather than following, and the refusal fires on ordinary work more than once |

A bet this table says "promote when" about, and the plan already schedules, is settled: the
plan is the answer to *when*, and this table records only why the bet was made.

One debt still demoted: **storage that survives concurrency.** Flat JSON remains right for
one person on one machine — and it is what made this pass possible, since every finding
above came from reading it with `cat`. The team plane does not change that: each machine
keeps its own store, and the shared ledger is append-only, one file per machine, for exactly
this reason. It comes back if the run queue corrupts it.

---

## Shipped

Parallel sessions on worktrees · project checks gating merges · sessions that repair their
own failing checks · verdicts that expire when the base moves · ordered landing of several
finished sessions · rituals that retry once and stop when they have clearly broken ·
sandboxed runs that name the host they were refused · rituals that fire when a PR opens or
CI goes red · the rate limit shown beside the spend and enforced against unattended work ·
permission handling for unattended runs · spend tracking and hard limits ·
multi-repository projects · MCP management · GitHub skill import · marketplace and plugin
install · workflow builder · relationship graph · backups · editing a file without leaving
the session · a real shell in the workspace · running the session's app and looking at it ·
rewind, guarded at the branch point · choosing how far a session is trusted before it
starts · following the pull request after it is opened · rituals that are a chain of steps,
counted as one firing · picking a branch or pull request from what exists · one screen for
what needs you · an inbox over Notion and Slack with the discovery cached · agents,
commands and skills as one library · ⌘K that does things · the night as a picture · the
order six branches will land in, drawn · several sessions started from one press.

**Since the fifth pass** (0.5.3 → 0.9.0, 27 commits): a run that reached three of its six
sources no longer reports as trouble-free · a queue that stops calling April's pull request
this morning's problem · twelve strays offered for adoption rather than mourned as lost
conversations · a diff measured from the base *branch*, so merging the base in stops
handing you its commits · a merge recorded when it happens, by all three routes that can
do it, and named by which one did · the standing brief · the morning message, and a reply
to it that becomes a session, guarded to a direct message · a screen to leave on, and the
noises it makes when something lands · Fleet as twenty rows in aligned columns, acted on
from the row · pull requests and the inbox from every project, each stamped with its age ·
a strip of twelve figures in a fixed order where only bad news is lit · Now as a queue that
empties · Work as two jobs · landing as one page · Fleet as an ordinary page with a sidebar
that collapses · one centred frame.

**And deleted**: cinema mode, the voice grammar, the act components, the Live panel, the
poster layout, the sound effects, the Now bands that described work going fine, and the
configuration advice nobody opened the page for.

---

## Still not planned

- **Mobile, remote access, authentication, hosted mode.** Unchanged by the team plane, and
  the reason is the point of it: several people, each on their own machine, with a git
  remote as the only thing between them. `HOST=0.0.0.0` with its documented threat model is
  still the whole answer.
- **Webhooks.** A port open to the internet is a different product. Polling asks the same
  question from inside.
- **Non-Claude model backends.** This runs what its author pays for.
- **Telemetry.** Refused on principle, and pointless: this pass learned more from `cat`-ing
  one machine's JSON than any event stream would have said. The shared ledger is not a
  softening of this — it is a team's own outcomes, on the team's own branch, readable the
  same way, and it leaves the machine only when somebody pushes it.
