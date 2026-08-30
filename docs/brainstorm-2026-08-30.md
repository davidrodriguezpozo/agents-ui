# The sixth pass — a brainstorm

30 August 2026. Written after `docs/plan/` ran out: all thirty-three briefs (00–32) carry a
`## Findings` section and none came back `## Blocked`, so there is nothing left to hand out.
This is the document that decides what the next wave is about.

It has two halves and they disagree. The first is a census — the store read with `cat`, the
same instrument as the fifth pass. The second is what the *work* in that store turns out to
be, which is not what this app says it is for.

---

## The census, read off `~/.claude/agents-ui`

| | Fifth pass (19 Aug) | Now (29 Aug) |
| --- | --- | --- |
| Runs on record | 158 | **538** |
| Spend those runs account for | $10.97 on the page | **$1,269.05** in the records |
| Sessions | 46 | **132** (43 idle, 89 archived; 103 created in the last fortnight) |
| Landings | — | **13** |
| Worktrees on disk | 58, 47 GB | **27, 12.8 GB** |
| Rituals | 1 | 2, one a disabled duplicate of the other |
| Runs killed by a restart | 25 | **29** |

### 1. About $98 of agent time per landed session, and no screen says so

$1,269.05 across 538 runs in 26 days, against 13 landings. Cost per accepted merge is unit
12's Ledger tab — third tab on `/work`, two clicks from where work starts. The figure that
would change a decision is the one you see *before* pressing Start.

**56 runs record `costUsd: 0`**, 29 of them because a restart killed them mid-flight. So
$1,269 is a floor, and the gap is exactly the runs that produced nothing.

### 2. No run has ever recorded a model, so half the ledger is empty by construction

`outcomes.ts:230` reads `run.stats?.model`. Nothing writes it — all 538 records carry
`usage`, `costUsd`, `durationMs`, `numTurns`, and no `model`. `OutcomeReport.byModel` is one
bucket called `undefined`, in the page whose purpose is telling you which choices earn their
cost.

What *is* recorded is `provider`: 134 `claude`, 3 `cursor`, 401 from before the seam. **The
ledger has `byAgent`, `byModel`, `byRepository` — and no `byProvider`.** The one comparison
the app could honestly make is the one it does not offer.

### 3. Nothing has ever been raced

`raceId` is on `Session` (`sessions.ts:111`), the control is on the Start box
(`work.vue:1224`), the reading surface exists, unit 32's tests pass. **Zero of 132 sessions
carry the field.** Shipped in 0.25.0 and never pressed once, by the person who asked for it.

### 4. Cursor is a rate-limit escape hatch, and the app does not know it

3 runs of 538, one session of 132, and `project-provider.json` records `claude` for both
repositories that are actually worked in. The census could not say why, so it was asked:
**Claude until the tokens run out, then Cursor.** Not a comparison, not a preference — a
substitution, made by hand, at the moment one agent stops being available.

That makes three things the app already has into one feature it does not:

1. **It knows when Claude is out.** The SDK emits `rate_limit_event` during runs that were
   happening anyway; `quota.json` holds `status`, `resetsAt`, `rateLimitType`.
2. **It knows another agent exists and can run a turn.** `providers/index.ts`, proved by
   unit 31.
3. **At the moment it refuses work for the rate limit it has the repository in hand.**
   `budget.ts:108–111`: `checkBudget(now, { unattended: true })` reads the quota and returns
   `{ allowed: false, reason }`. Seven call sites go through it.

**The refusal is one decision away from a reroute**, and nothing joins the three.

### 5. Two rituals, identically named, one silently disabled

`Morning brief` (enabled) and `Morning brief` (disabled) — almost certainly a duplicate made
by accident and switched off rather than deleted. The schedules page shows two rows with the
same name and no way to tell them apart. Rituals *can* choose a provider
(`schedules.ts:68`); the live one does not.

### 6. The restart hole is still open on the interactive side

29 runs killed by *"the server stopped while this was running"*. `restartRecovery` puts a
ritual's clock back; `server/plugins/interrupted.ts:30` closes an interactive turn and sets
the session idle, and the instruction is gone. The record holds `sdkSessionId` and `input` —
everything a resume needs, sitting on disk, unread. Working on this app remains the main way
of losing work in it.

*(Demonstrated again while this document was being written: another session landed into the
main checkout mid-sentence and took an untracked file with it.)*

### 7. Disk: cleaned by hand, again

27 worktrees, 12.8 GB — down from 58 and 47 GB because a person ran `du` and deleted things.
**haddock: 5 worktrees, 9.5 GB**, 1.9 GB per session before a line is written. almaria holds
11 worktrees in 2.2 GB, so the cost is per-repository and the monorepo is where it hurts.
Nothing in the app has ever printed a gigabyte.

### 8. Workflows: two runs, both on 6 August, both the same workflow

`email-workflow`, twice, three weeks ago.

---

## The reframe: what this app is actually used for

The census measures the machinery. This measures the work, and it does not say what the
README says.

| | |
| --- | --- |
| Sessions by repository | **haddock 77**, agents-ui 27, almaria 11, duende 10, marketing 8 |
| Sessions reviewing someone else's branch | **26** |
| Sessions on a detached or borrowed checkout | **41** |
| Sessions carrying a pull request URL | **45** |
| Rituals | **1** |

The instructions, sampled across all 538 runs, are one loop repeated:

> `/haddock-tech:review <pr>` · *"Approve, and comment the WARN findings"* · *"Let's request
> changes, and comment the BLOCKING and WARN findings"* · `/haddock-tech:address-pr <pr>` ·
> *"Let's fix the CI here: <pr>"* — five separate times · *"Let's rebase 5699 onto master,
> there are conflicts"* · *"Let's address the comments left in this PR"* · *"push please"*

**The README opens with "Leave Claude Code running — work that fires on a schedule."** There
is one ritual on this machine and it writes a morning brief. What actually happens, seventy
seven sessions' worth, is **the pull request loop in a monorepo shared with colleagues**:
review someone's branch, post a verdict with severities, take the comments back on your own,
fix CI when it goes red, rebase when master moves, push.

Three census findings stop being puzzling once this is the frame:

- **41 detached or borrowed checkouts.** Reviewing a colleague's branch is the dominant
  session shape — and it is exactly what produced roadmap item 1's drift bug and the
  `mergeRefusal` written for it. The most common thing this app does is the thing its data
  model was written for last.
- **Zero races, one ritual.** Nobody races a code review, and nobody schedules the pull
  request that arrived ten minutes ago. The two headline features answer a question this
  user does not have.
- **9.5 GB in haddock.** Five colleagues' branches, checked out in full.

None of this was designed. It emerged, it is most of what the app has ever done, and the
product has no word for it.

---

## Direction A — the provider seam is a failover, not a comparison

No Anthropic product will ever route your work to Cursor when your Anthropic limit runs out.
That is not a feature they can ship, and it is the one differentiator here that gets
*better* the more capable Claude Code becomes.

**A1. Failover instead of pause.** `pauseOnQuotaWarning` is a checkbox with two answers —
carry on, or stop. It wants a third: *continue on Cursor*. Unattended work currently held
back when Claude is rejected keeps going, and the run records which provider it used and
why. The thing that must not be got wrong: a substitution nobody is told about is how you
find out in the morning that eleven runs went to an agent you did not pick — so it says so
on the run, on the ritual's row, and in the morning report.

**A2. Hand a live session to the other agent.** The manual move is not "start again on
Cursor", it is "carry on with this branch on Cursor". The session id cannot transfer —
`sdkSessionId` is Claude's, Cursor keeps its chats under `CURSOR_DATA_DIR` — but the work
transfers whole (same worktree, same branch, same diff) and the conversation transfers as a
hand-off. `sessionSummary.ts` already writes exactly that summary. `sessionTurn.ts:431`
already reads the provider per *turn*, so a session that changes agent mid-life is closer to
free than it looks. Two costs go on the button: the new agent has read the summary, not the
conversation; and steering stops, because `capabilitiesOf('cursor').canSteer` is false.

**A3. The rate limit becomes a status, not a warning** — *"Claude is out until 19:30, this
is running on Cursor"* belongs beside what wants you.

**A4. `byProvider` on the ledger, and the model on the run.** With failover in place the
question stops being *which vendor is better* — unanswerable, and nobody's decision — and
becomes the one that settles whether failover defaults on: **what did the hours after the
limit cost, and did that work land at the same rate?**

**A5. Race is demoted, and its machinery reused.** You never wanted two agents on one
instruction; you wanted one agent and a substitute. `candidates`, the stale-verdict rule and
"an entrant that has already passed is landable" all apply to the failover path.

**A6. A third provider.** *"Adding Codex is adding a file and a line here"* —
`providers/index.ts` says so itself. After failover proves itself, not before.

**A7. Say it out loud.** The pinned roadmap issue still says *"Non-Claude model backends —
not planned"*. Units 31 and 32 shipped it, and A1 turns it into a sentence a lot of Max
subscribers feel every week: **the rate limit stops ending your day.**

---

## Direction B — what the census says to fix

**B1. One honest figure in gigabytes**, on the worktree panel and the sessions list, plus a
**batch finish** (batch start goes to twenty) and a broom that reaches the projects you are
not standing in. *Roadmap Now #4.*

**B2. Resume an interrupted turn.** `sdkSessionId` and `input` are on the record; the
plumbing exists for rituals. Offer it on the session, take it automatically when unattended.
Interrupted runs also stop recording `costUsd: 0`. *Roadmap Now #3.*

**B3. Attention counts four sources, wall-wide.** `AttentionKind` is still
`blocked-session | failing-ritual`; pulls, digest and inbox go uncounted, and the pull read
is project-scoped where `wallPulls.ts` reads all five repositories. Shared with the MCP
`blocked` tool, so it widens two surfaces at once. *Roadmap Now #2.*

**B4. Cost where the decision is.** $98 per landed session belongs beside the Start box.

**B5. A duplicate ritual is a mistake the page can refuse** — or at least name.

**B6. Decide, per surface: default on, or delete.** *Roadmap Now #5*, now with numbers.

---

## Direction C — reach

No telemetry, ever — so the only thing that can tell you what to build is what people say.
**14 stars. 84 views and 14 unique visitors in a fortnight. The pinned roadmap issue has
zero comments and zero reactions.** The launch checklist's blocking items are ticked; the
ten-minute ones are not.

**C1.** The repo description is still the March one — *"UI to manage Claude Code agents,
skills, commands…"*. The right sentence and the `gh repo edit` command are already sitting
in `docs/launch/CHECKLIST.md`.
**C2.** No topics at all (`repositoryTopics: null`).
**C3.** `docs/images/social-preview.png` is in the repository and has never been uploaded,
so every link posted anywhere renders as a grey box.
**C4.** Discussions are disabled, and the issue template links to them.
**C5.** The drafts lead with parallel sessions on worktrees, which has been `claude -w` since
February. The honest pitch has two halves and neither is in them: what happens *after* a run
when nobody is watching, and that it is not tied to one vendor's agent.
**C6.** Three `good first issue`s the census just wrote: the model on the run (A4), the
duplicate ritual name (B5), a gigabyte figure on one panel (B1).

---

## Direction D — the pull request as a first-class object

The strongest idea here, and the census had to be read twice to see it. Today a pull request
is a URL somebody pastes into a session title. Everything the app knows about #5759 — the
review session, the findings posted, the comments that came back, the CI runs, the rebase,
the merge — is scattered across sessions, runs, reviews, `prWatch` and the wall, joined by
nothing but a string in a title.

**D1. A PR page.** One object, the way `Session` is an object: its branch, its checks, its
review session, what was posted, what came back, what it cost. Every list already half-knows
this; nothing owns it.

**D2. The verdict is a control, not a sentence you type — and this is already built.**
Checked after writing the sentence above, which is the correct order to find this out in:
`reviewReport.ts` parses the report's severities, `includeByDefault` includes BLOCKING and
WARN and nothing else, `suggestedEvent` picks the event and deliberately never pre-selects
APPROVE, `reviewDraft.ts` holds the editable draft, and `reviewPost.ts` sends it as one
review behind a guard no agent can reach. It landed between 20 and 27 August; nearly all the
typing in the corpus predates it. **The gap this was going to name does not exist**, and the
right conclusion is the opposite one: the newest part of the app is the part built for what
the app is actually used for, which is the strongest evidence in this document for D.

**D3. Batch review.** Five waiting PRs is five presses, five worktrees and five pastes
today. It should be one press, your own review command, and a queue walked with `j`/`k`,
approving or requesting changes at the end of each.

**D4. "Fix the CI here" as a ritual aimed at your own open PRs.** Typed five times by hand.
`prWatch` already reads GitHub's checks and hands a red result back to the session that wrote
the code — but only for pull requests this app opened. The trigger for the rest exists
(`workflow_run` failed, in `eventTriggers.ts`) and nothing joins it to the branch you have
open.

**D5. Rebase without a session.** *"Let's rebase 5699 onto master, there are conflicts"*.
`updateFromBase` does exactly this and is reachable only from a session the app started.

*What would settle it:* nothing — this is most of recorded use with no home in the product.
The real question is how much of it is `haddock`'s custom commands, which are yours and stay
yours, and how much is the app's.

---

## Direction E — the corrections corpus

538 run records hold every instruction you have given, with 30 MB of events beside them, and
much of it is correction: *"I don't care about the accessibility honestly"* · *"The thing is,
I already have my custom command to review pull requests"* · *"Approve. Leave no comments"*.

`lessons.ts` and `lessonProposals.ts` already turn signals into proposed `CLAUDE.md` rules —
but the signals are denied hosts, reverts and flaky checks, and the store holds exactly
**one** decision, a rejection. The richer source was never read: **the things you said to the
agent after it did the wrong thing.**

**E1. Mine your own corrections into rules.** "You have told it three times this month not to
touch the accessibility pass" is a proposed line in `CLAUDE.md` with three citations —
existing proposal machinery, pointed at a corpus nothing else has a copy of.
**E2. Per repository, because the corrections are.** What you tell it about `haddock` is not
what you tell it about `marketing`.

*What would settle it:* one accepted rule that stops a correction recurring. It is also the
only idea here that compounds with use.

---

## Direction F — receipts, not just merges

As more of a shared monorepo is written by agents, "who wrote this and what checked it"
becomes a question somebody at work asks out loud. `git blame` says you.

**F1. A receipt per landed change** — the diff, the checks and their verdicts, the agent and
model, the cost, the review findings posted against it, who pressed merge. Units 17, 27 and
28 built every part; nothing assembles the one page you would hand somebody.
**F2. Provenance in the editor** — which lines came from a run, which run, what gate it
passed.

*What would settle it:* the first time somebody at work asks how much of a PR an agent wrote.
The first differentiator about the team's trust rather than your convenience.

---

## Direction G — the cheap layer

$1,269 in 26 days, and 516 of 538 runs are `chat`. Nothing here has ever chosen a cheaper
model for the cheap half of the work — because, per census item 2, it does not record the
model at all.

**G1. Triage cheap, execute expensive** — deciding whether a PR is worth a full review,
classifying an inbox row. `sessionSummary.ts` is the only place a small model is used today.
**G2. A budget per task, not per day.** *"This is worth five dollars"* is the unit people
think in; the daily cap is the unit the machine finds easy.
**G3. One keystroke of self-report after a landing** — was it worth it. `selfReported.ts`
exists, and against no telemetry it is the only signal there will ever be.

---

## Direction H — subtraction

Workflows 2 runs · race 0 · lesson decisions 1 · rituals 1 · merge train 0 completions. Five
surfaces built well and used never, and a README that needs a ten-row navigation table.

A real direction, not a chore: cut to Now, Work, Land, Daily and Library, delete or default
the rest, and see whether what remains can be described in one sentence to somebody who has
never heard of it. Every deletion this project has made — cinema mode, the voice grammar, the
act components, the Live panel, the poster layout — improved the release it was in.

*What would settle it:* the one-sentence description. If cutting five surfaces does not
produce one, the surfaces were not the problem.

---

## Direction I — the terminal, for someone who lives in one

There is a TUI (`cli/`, `docs/tui.md`) and a web page you alt-tab to. The dominant loop —
walk the review queue, approve, request changes, fix CI, push — is keyboard work on a list,
which is the one thing a terminal does better than a browser.

**I1. The review queue in the TUI**, `j`/`k`/`a`/`r`, no mouse, no tab switch.
**I2. `agents-studio` where you already are** — open the session for the branch you are on.

*What would settle it:* whether you would leave it open. Not a rewrite — the web app won the
workbench argument once — just the one list that should not need a browser.

---

## Where this leaves it

A, B and C were chosen before the evidence arrived and are all still worth doing. Only one of
the nine is a *bet about what the product is*, and it is D.

**The bet: this is a pull request workbench that happens to run unattended, not a scheduler
that happens to open pull requests.** Most recorded use says so, the README says the
opposite, and the two headline features are answers to a question this machine has never
asked.

1. **D3 — batch review.** 26 review sessions on record, each started by hand, and every
   part of doing N at once already exists (`intentFor`, `turnForIntent`, `work.post.ts`,
   `batch.post.ts`) with nothing composing them. D2 turned out to be built already — see
   above — which is the good kind of finding.
2. **A1 — failover instead of pause.** Three facts the app holds, joined at one refusal
   already written. It is also what keeps the loop moving after 16:00.
3. **D4 — "fix the CI here" as a ritual on your own open PRs.** Typed five times by hand;
   every part exists and nothing joins them.
4. **C1–C4** — description, topics, social preview, Discussions. Ten minutes, and the pitch
   to put in them is now much better than parallel sessions: *the PR loop, run by an agent,
   gated on your own tests, and it does not stop when your Claude limit does.*
5. **A4 — model on the run, `byProvider` on the ledger.** Smallest brief here, and the
   precondition for every cost question in G.

**E is the sleeper** — the only idea that compounds, on a corpus that already exists.
**H is to be decided rather than built**, and has been deferred through two roadmap passes.

---

## What this is not

Every number came from one machine, read with `cat`, and describes how **one person** uses
the app. Same instrument as the fifth pass and the same caveat: evidence about this
installation, not about users. Enough to decide what to build next; not enough to decide what
the product is for. That second question is what Direction C exists to make answerable.
