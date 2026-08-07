# Roadmap

Written August 2026, against Claude Code 2.1.224 and the Desktop redesign of April 2026.
This is the internal version — what to build and why. The public one is
[launch/roadmap-issue.md](launch/roadmap-issue.md), and it should be regenerated from
this whenever something here moves.

## Who this is for

**Solo developers, working in small teams.** One person, one machine, one instance —
that is the permanent deployment model, not a stage on the way to a hosted one.

Two decisions follow from that, and they close off a lot of the map:

- **No mobile, no remote access, no auth.** It stays on `127.0.0.1` with same-origin
  checks in front of it and nothing else. Anything that needs to reach you when you are
  away from the machine is a desktop notification.
- **No shared server.** Teammates do not watch one fleet. Each runs their own.

Which means the team half of "solo devs in small teams" is not multi-user software. It
is **configuration that travels through git** — the rituals, checks and agents a team
shares by committing them — and **not colliding with the branches your teammates already
have open**. Both are cheap. Neither needs the storage rewrite that a hosted mode would.

## Where this sits

Claude Code Desktop shipped parallel sessions on worktrees in April 2026, with a diff
viewer, an integrated terminal, a file editor and PR monitoring. Routines shipped
scheduled cloud agents in the same month, triggered by cron, API call or GitHub event.
CLI 2.1.224 lets Team and Enterprise run web, mobile and desktop sessions on their own
machines.

So *parallel sessions* is table stakes, and *fires against a local repository* is
contested and will not stay ours. What is not contested:

- Your own test suite as a merge gate, with the workspace made runnable first
- A verdict that expires when the base moves under it
- Sessions that repair their own failing checks
- Landing several finished sessions in an order that accounts for each other
- Scheduled work that retries once, then stops once it has clearly broken
- A spend cap that skips work rather than billing you
- Sandboxed unattended runs that cannot let themselves out
- Every repository at once

Nobody else has any of that. **The pitch is not "local and scheduled". It is that the
work is verified and lands safely, at fleet scale, without you.** Everything below is
ordered by how much it serves that sentence.

---

## Pre-launch

The product is ahead of its positioning. Nothing in this section is a feature; all of it
blocks a post going out, and it is worth more right now than anything in *Now*.

- ~~Fix the README comparison table.~~ Done — the local-repo row is now last, and the
  paragraph under it concedes that self-hosted environments are closing that gap rather
  than waiting to be caught claiming otherwise.
- **Rewrite the launch drafts around the unattended pitch.** Tracked in
  [launch/CHECKLIST.md](launch/CHECKLIST.md); the drafts still lead with parallel
  sessions, which is the one thing that now invites the obvious comment.
- **The hero GIF.** Ritual fires → run → session whose checks passed → merge. The single
  highest-leverage asset and the only one that shows the pitch rather than asserting it.

---

## Shipped since this was written

**Sandboxed unattended runs.** The SDK's `sandbox` option is set per project beside the
check command, on by default — including for projects configured before it existed. A run
cannot let itself out (`allowUnsandboxedCommands: false`); widening the host list stays
something the owner does on purpose. It was the loudest unanswered objection to the whole
product: we are the thing that tells people to walk away from a running agent, and we
were the only one with no isolation story.

It turned out to pay twice. `autoAllowBashIfSandboxed` means a sandboxed command need not
stop and ask, so the failure this codebase spends the most effort on — a ritual back at
08:00 having been refused a tool, half its job undone — largely stops happening.
Sandboxed runs are both safer and likelier to finish, which is the line the launch post
should use.

**Saying what it refused.** Shipped straight after, once a real blocked run had been
watched rather than guessed at. A run that could not reach a host now records which one,
counts as `blocked` rather than as a clean success, sorts in with the work that needs
you, and offers to allow exactly that host in this repository — the same shape as a
blocked permission offering its narrow rule.

The empirical part was the whole job, and it went against expectation twice. The SDK
reports nothing structured, so the denial only ever exists as text, and that text comes
in four shapes: `curl` gets a proxy 403 with no host in it, `git` gets the same 403 with
the URL attached, Node's `fetch` never reaches the proxy at all and fails DNS, and —
the one that matters — a run through *this app's* own configuration gets none of those.
It gets a plain connection timeout, because the packets are dropped rather than refused.
A detector built from the docs, or from the bare-SDK probe alone, would have matched the
403 and found nothing in the case users actually hit.

The timeout is the one ambiguous signature, since a slow host says the same thing. It
counts only for hosts the project has not already allowed: one you allowed and still
could not reach is the network, and calling that a refusal would mark a ritual `blocked`
and rob it of the retry a transient failure deserves.

**Warning before it bites.** A project with rituals that have already run — which is
exactly the population whose unattended work predates the sandbox — is told on the Daily
page, while everything still works, rather than at 08:00 on the morning one of them
stops. Three conditions, all of them load-bearing: nothing chosen here yet, scheduled
work that has actually run, and not already acknowledged. A banner on every project
would be dismissed unread by the people who most need it.

Acknowledging is deliberately not choosing. It is recorded in its own file, so a project
that has read the notice still reads as *unconfigured* and does not lose its "reset to
the default".

**Leaving room on the subscription.** The quota work below, shipped.

---

## Shipped, and what it changed about the plan

### Quota alongside spend

Done, but **not as written below** — the design in the original entry was wrong, and a
single real `rate_limit_event` was enough to show it.

The plan was "skip work once the week is 80% burned". The SDK does emit rate-limit
information, and it arrives free during runs that were happening anyway. But the real
payload disagreed twice:

- **`utilization` is usually absent.** It appears only when there is something to
  report. A limit expressed as a percentage would have had nothing to read most of the
  time and would have silently never fired — the worst kind of limit, one people believe
  they have.
- **`resetsAt` is in seconds**, where everything else in this codebase is milliseconds.
  Unconverted, it dates the reset to 1970.

What is always present is `status` — `allowed` / `allowed_warning` / `rejected` — which
is Anthropic's own judgement of how close you are, and better than a number we would
have to interpret. So the limit is "hold unattended work back while Claude says I am
close", and it reads the signal rather than second-guessing it.

Applied only to work nobody asked for right now: rituals, and workflow steps after the
first. A turn you typed is never held back — you can see the state of your own account,
and being refused by your own tool for something you deliberately started is the wrong
side of helpful. A reading older than six hours is ignored, since a five-hour window
turns over completely in that time and a stale warning would keep skipping rituals for a
limit that had already reset.

Off by default, like the spending caps and for the same reason.

**And on the spend page**, which is where the question is actually asked. The reading
sits directly under the dollar figure it qualifies — a coloured dot, the window, and when
it resets — with the expanded panel leading on *Against your limit* before *Where it
went*, and saying in as many words that the money above is what these runs would have
cost through the API rather than a bill.

Three states, all of them real and all of them checked: nothing heard yet (normal on a
fresh install, since this arrives with a run rather than being fetched), a live reading,
and a stale one. A stale `rejected` is suppressed entirely rather than shown greyed —
telling somebody their limit is used up on the strength of a six-hour-old reading is
worse than telling them nothing.

`utilization` gets a bar when it is present and nothing when it is not, which is most of
the time. It arrives as a fraction or a percentage depending on the window, so both are
normalised rather than assumed.

---

## Now

### 1. Rituals that fire on an event

A ritual triggers on a GitHub event — PR opened, check run failed, issue labelled — as
well as on a clock. Poll through `gh` first; webhooks can come later.

The scheduler, run queue and health tracking all already exist, so this is a new trigger
source feeding a pipeline that is built. It matters because the clock caps a ritual at
roughly one a morning and events do not, and because event-triggered work is what people
are actually adopting Routines for.

---

## Next

### 2. Ritual chains

Triage → fix → verify → open a PR, as one ritual with one health record, rather than
three that do not know about each other. The hard half — deciding what lands in what
order — is already done in `lander.ts`.

### 3. The PR after the merge

We can open a pull request; we then forget it. Watch it, react to a CI failure or a
review comment, land it when it goes green. Desktop does monitoring and auto-merge. The
differentiated version is the same loop with our verdict system attached to it.

### 4. Configuration that travels through git

Rituals, check commands and setup commands committed to the repository instead of living
only in `~/.claude`, so a small team shares them by pulling. Today a teammate cloning the
repo gets none of it and has to be told.

This is the entire team story, and it is a file-format change rather than a server.

### 5. Landing without colliding

Before landing, look at what is already open against the base — teammates' branches and
PRs, not just our own sessions. Ordered landing solves this within one machine's sessions
and is blind to everything outside them, which is exactly the case a small team hits.

---

## Later

- Which rituals and agents earn their cost, over ninety days
- Session templates — the same five-way fan-out, saved
- Reasoning effort per ritual, not just model
- A read-only view for a second monitor
- Storage that survives concurrency — demoted, not dropped. It was gating remote and
  shared modes, and both are now out of scope. It comes back if flat JSON actually
  corrupts under the run queue, and not before.

## Not planned

- **Integrated terminal, file editor, live preview, rewind.** Desktop owns the
  workbench. Every hour spent here is an hour losing a race we do not need to enter.
- **Mobile, remote access, authentication, hosted mode.** See *Who this is for*.
- **Non-Claude model backends.** Everything runs through the Agent SDK and the login you
  already have.
- **Telemetry.** Of any kind.

---

## What each bet is supposed to move

| Bet | The number it changes |
| --- | --- |
| Sandboxing | Share of people who enable a ritual and still have it on in week three |
| Quota-aware limits | Share of people who set any cap at all |
| Event triggers | Rituals per person — the clock ceiling is about one a morning |
| Config through git | Second and third installs inside the same team |
