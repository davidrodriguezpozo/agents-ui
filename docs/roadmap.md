# Roadmap

Second pass, August 2026, written after a build cycle rather than before one. Against
Claude Code 2.1.224 and the Desktop redesign of April 2026. The public version is
[launch/roadmap-issue.md](launch/roadmap-issue.md) and should be regenerated from this
whenever something here moves.

## Where this actually is

Four things shipped this cycle: sandboxed runs, saying which host a sandbox refused, the
rate limit shown and enforced, and rituals that fire on GitHub events. All four were
worth building and three of them changed shape once a real payload was looked at.

**None of them were asked for by a user, because there are no users.** This has not
launched. Every item was chosen by reasoning about what the product needs, which is a
legitimate way to build a pre-launch product and also the way you end up with four
well-made features nobody requested and one missing thing everybody wants.

So the honest reading of the last cycle is: the build is ahead of the evidence. The
constraint now is not what to build — it is that there is no way to find out. Which
makes the roadmap short.

## The thing to settle before launching: laptops sleep

The README's first line is *"Leave Claude Code running — work that fires on a schedule
against your own repositories."* The deployment is one person's laptop.

A laptop is shut at 08:00. An overdue ritual fires if the lid opens within two hours and
is **silently skipped** after that — no notification, no record, nothing on the Activity
page. The most likely first experience of the headline feature is therefore: set a
morning briefing, open the laptop after lunch, see nothing at all, and conclude it does
not work.

Meanwhile Routines run in Anthropic's cloud and genuinely do fire at 08:00. This is the
one row where the competitor is not merely close but strictly better, on the exact
promise the README leads with.

Three consequences, in increasing order of how much they change:

1. **The silence is a bug and it is cheap to fix.** See *Now*.
2. **Events fit the deployment better than the clock does.** They fire whenever the
   machine is awake, so there is no window to miss. The feature shipped last is arguably
   the one the pitch should lead with.
3. **The pitch may be slightly wrong.** Not "work that fires at 08:00" — that invites the
   comparison we lose — but *work that happens while you are working rather than while
   you are watching*. Same product, no promise the hardware cannot keep.

I am not going to rewrite the positioning unilaterally; it is yours and the current one
is not dishonest. But the launch drafts are being rewritten anyway, and this is the
decision to make while doing it.

---

## Now

Nothing. The last item — a missed ritual saying so — shipped; see below.

Launch is off this list by decision, and the checklist in
[launch/CHECKLIST.md](launch/CHECKLIST.md) is where it lives if it comes back. Worth
being clear about the consequence: the argument above resolves by launching, so with
that off the table this stays a roadmap written from reasoning rather than from
evidence, and it will keep being one. Everything under *After launch* is now waiting on
a signal that, by this decision, will not arrive — so the next thing built here will be
chosen the same way the last four were.

### Shipped: a skipped ritual says so

A ritual more than two hours overdue was advanced to its next occurrence without a word.
Every other way a ritual produces no work is loud — refused a tool, blocked by the
sandbox, over the spending limit, over the rate limit — and this was the quietest and
the most common, because it happens every time the machine was shut.

It is now noted on the ritual and reported in *while you were away*, in the muted
register rather than the alarming one: nothing failed, the machine was off.

The design constraint was the interesting part, and it is the opposite of the obvious
implementation. **A miss must not be recorded as a run.** `ritualHistory` counts anything
that is not `ok`, `running` or `stopped` towards the failing streak, and `shouldGiveUp`
disables a ritual at three — so a skipped run in the log would turn a briefing off for
good after three shut laptops, which is precisely what somebody returning to a cold
machine must not find. It lives on the schedule instead, is cleared the moment the ritual
runs, and is deliberately left out of the *needs you* count: nothing is blocked and there
is nothing to approve.

---

## After launch — bets, and what would settle each

Deliberately unordered. There is no telemetry here and there never will be, so the only
evidence that will ever arrive is what people say in issues and threads. Ordering these
now would be guessing twice: once about what matters, and once about what people will
report. Each is written with the signal that promotes it.

| Bet | Promote it when somebody says |
| --- | --- |
| **More event kinds** — issue labelled, review requested, comment mentioning you | "I want it to fire on X" — the likeliest first request, since events are new and only two exist |
| **Event runs that are legible** — three identical rows in Activity is what an event ritual produces today | "I can't tell which PR this one was about" |
| **Ritual chains** — triage → fix → verify → open a PR as one unit with one health record | "I've got three rituals that need to know about each other" |
| **The PR after the merge** — watch it, react to red CI, land it when green | "It opened the PR and then forgot about it" |
| **Configuration that travels through git** — rituals and checks committed to the repo | Anyone describing a second person in the same repo. This is the entire team story and it is a file format, not a server |
| **Landing without colliding** — look at teammates' open branches, not only our own sessions | Same signal as above, arriving later |
| **Which rituals earn their cost** | "I don't know if this is worth what it spends" |

Two that need no signal because they are debts rather than bets:

- **The event lookback is a cap.** Fifty runs back covers a weekend; it does not cover a
  fortnight. A poll that cannot reach its own cursor should say so rather than quietly
  skip the difference.
- **Storage that survives concurrency.** Still demoted — flat JSON is the permanent design
  for one person on one machine. It comes back if the run queue actually corrupts it, and
  not before.

---

## Shipped

Parallel sessions on worktrees · project checks gating merges · sessions that repair
their own failing checks · verdicts that expire when the base moves · ordered landing of
several finished sessions · rituals that retry once and stop when they have clearly
broken · **sandboxed runs, on by default, that name the host they were refused** ·
**rituals that fire when a PR opens or CI goes red** · **the rate limit shown beside the
spend and enforced against unattended work** · permission handling for unattended runs ·
spend tracking and hard limits · multi-repository projects · MCP management · GitHub skill
import · marketplace and plugin install · workflow builder · relationship graph · backups.

Three of the four things built this cycle changed design once a real payload was
inspected — the sandbox denial text, the rate-limit payload, and the event lookback
window. That is worth keeping as a working rule rather than as an anecdote: **for
anything that reads somebody else's output, look at the real output before designing
around it.** It cost one cheap probe each time and would have shipped three silent
no-ops otherwise.

---

## The direction changed: absorb the workbench

Decided deliberately, and it reverses the previous position. This used to say Desktop
owns the workbench and every hour spent there was an hour losing a race. The counter-
argument is simpler and was accepted: **people do not run two things.** A tool you only
open when something is wrong is a tool that has to be worth opening, and the way it
becomes worth opening is that you can finish the work in it.

The failure mode is obvious and worth naming so it can be steered around: *absorb* done
badly is a worse Desktop, built by one person, arriving second. So it is defined
narrowly.

**Absorb means: you never have to leave a session's workspace to finish its work.** Not
"have every feature Desktop has". The test for anything below is whether it removes a
reason people currently alt-tab away, and whether it compounds with what is already here
— worktrees, checks, verdicts, landing — rather than sitting beside it.

Ordered by how often it forces somebody out, which is not the same as by size.

### 1. Open and edit a file in the workspace

The commonest exit by a distance: the agent got it nearly right and you want to change
one line. Today that means finding the worktree on disk and opening your editor.

It compounds rather than duplicates. Editing a workspace already invalidates its verdict
— `worktreeFingerprint` covers uncommitted content, so a check result is already marked
as describing code that no longer exists. Edit, re-check, land: that loop exists and has
a hole in the middle where the editing should be.

Needs a file tree and read/write scoped to the worktree, and the scoping is the whole
job — a path that escapes the workspace is arbitrary file write on the machine, reachable
from a page.

### ~~2. A terminal in the workspace~~ — shipped

The fork was taken as recommended: no native dependency, and the no-compile
install survives. `node-pty` would have ended it; `mcp.ts` already got a pty out
of Python, so this does too.

`pty.spawn` was not enough on its own — it keeps the master descriptor to
itself, so the child is stuck at 80x24 and a terminal you cannot resize is a
poor imitation of one. `os.openpty` hands the master back, which makes
`TIOCSWINSZ` possible and lets the child take `SIGWINCH`. Spiked before a line
of UI was written: interactive prompt, writes after start, incremental
streaming, a genuine tty, and 80 → 160 → 60 columns on demand.

**The framing was the part that had to be right.** A line-delimited protocol
cannot carry a terminal: `ls` with no Enter must stay unsent, Ctrl-C is a bare
`\x03`, and an arrow key is an escape sequence with no newline in it. The first
draft was line-based and would have run half-typed commands. Every message is
now `<kind><base64>\n` — base64 contains no newline, so the framing stays safe
while the payload reaches the pty byte for byte.

xterm.js does the rendering, because cursor movement, colour and alternate
screens are escape sequences and anything less turns `top` into a mess. Pure
JavaScript bundled into `.output` like `marked` and `@nuxt/ui` already are:
runtime dependencies stay at zero.

**Not sandboxed, deliberately.** The sandbox exists for work nobody is
watching. A person typing into their own shell, in their own checkout, on their
own machine is what the sandbox protects *from being impersonated* — not what
it protects against.

Shells outlive the tab on purpose, so a long build survives navigating away,
and are closed when nobody has watched one for half an hour or when the server
stops. An orphaned pty outlives the process that made it.

### ~~3. Run it and look at it~~ — shipped

The last step out: a diff says what changed and the checks say whether it still
passes, and neither answers "does it look right". So the project's dev command
runs in the session's workspace and the result is shown in the page.

Its own port per session, asked of the kernel rather than guessed, because the
point of worktrees is that several run at once and two dev servers fighting
over 3000 is the thrash the check queue already exists to prevent. The port
goes over `PORT`; a project that hardcodes one will collide across sessions,
and the UI says so rather than pretending otherwise.

The dev command sits beside the check and setup commands in Settings, guessed
from a `dev` target or a `dev`/`serve`/`start` script, with `dev` preferred
because `start` is as often "run the built thing".

**Spawned detached, in its own process group, and that is not cosmetic.**
Stopping means signalling the group — a dev command is nearly always a shell
running a package manager running the real server, and killing the shell alone
leaves the server holding the port. Without `detached` the child shares *this*
process group, so the kill would have taken the app down every time somebody
pressed Stop. Verified: the preview dies, the app answers, no orphan is left.

### ~~4. Rewind~~ — shipped, taken out of order

Fourth on frequency and first on value-per-hour, so it went second. Editing files by
hand is what made it matter: an agent's work was always recoverable by simply not
merging it, but a change you made yourself on top of a turn you now want gone was not.

Two things, kept apart because they cost differently — throw away what is uncommitted,
and take a whole turn off. Both name the files rather than counting them, because a
count is something you have to trust.

The guard is `baseSha`. A rewind must never pass the commit the session branched from:
below that is the repository's own history, which the session does not own and which no
button on a web page may destroy. Every reset target is checked to descend from the base
and refused otherwise rather than clamped to something plausible. Proven against a real
repository with prior commits — the refusal holds at the boundary and the history is
untouched.

`git clean -fd` without `-x`, so ignored files survive: a discard must not delete
`node_modules` and cost a fresh setup run.

### 5. Arranging the panes

Only once there are three things worth arranging. Not before.

### What this costs

Everything under *After launch* moves back. Absorb is not a feature, it is a second
product surface, and pretending it fits alongside the rest of the list would be the way
to do both badly.

## Still not planned

- **Mobile, remote access, authentication, hosted mode.** One person, one machine.
- **Webhooks.** Taking them means opening a port to the internet, which is a different
  product with a different threat model. Polling asks the same question from inside.
- **Non-Claude model backends.**
- **Telemetry.** Which is why the table above is written in sentences people might say
  rather than numbers nobody will ever see.
