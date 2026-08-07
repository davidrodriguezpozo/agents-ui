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

## Now — everything here blocks a post going out

### 1. A skipped ritual has to say so

`scheduler.ts` skips a ritual that is more than two hours overdue and advances it to the
next occurrence without a word. Every other way a ritual can fail to produce work is
reported — refused a tool, blocked by the sandbox, over the spending limit, over the rate
limit — and each of those was carefully made loud. This one is silent, and it is the most
common of the lot, because it happens every time the machine was shut.

It should record a skipped run, say why, and appear in *what happened while you were
away*. Offering to run it now is the obvious follow-up and can wait; being told is the
part that matters.

This is the single highest-value thing left, because it is the difference between "it
works and I was asleep" and "it does not work".

### 2. The launch drafts

Tracked in [launch/CHECKLIST.md](launch/CHECKLIST.md). They still lead with parallel
sessions, which Desktop shipped in April. Lead with what Desktop does not do: your own
tests as a merge gate, sandboxed unattended runs, work that reacts to your repository,
limits that skip work rather than bill you.

### 3. The hero GIF

Ritual fires → run → session whose checks passed → merge. The one asset that shows the
pitch rather than asserting it, and the only item on this page I cannot produce.

### 4. The rest of the checklist

Cold-machine install test, repo name decision, social preview, repo description and
topics. All small, all in the checklist, none of them optional.

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

## Not planned

- **Integrated terminal, file editor, live preview, rewind.** Desktop owns the workbench.
- **Mobile, remote access, authentication, hosted mode.** One person, one machine.
- **Webhooks.** Taking them means opening a port to the internet, which is a different
  product with a different threat model. Polling asks the same question from inside.
- **Non-Claude model backends.**
- **Telemetry.** Which is why the table above is written in sentences people might say
  rather than numbers nobody will ever see.
