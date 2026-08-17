# Roadmap

Fifth pass, August 2026, written at 0.5.3 with five commits on top. Against Claude Code
2.1.224, the Desktop redesign of April 2026, and the self-hosted environments beta of
August 2026. Earlier passes are in git history; where one of them was wrong it is named
here rather than quietly dropped.

## The audience is one person

Settled in the fourth pass and not reopened: the user is the person writing this. The tool
exists to make one engineer, tech lead and manager materially faster at those three jobs.
The repository stays public and MIT, and if anyone else finds it useful that is a bonus,
not a plan. The download curve is not a scoreboard, and the launch checklist is a chore
rather than a gate.

What that does *not* retire is rigour, and one cycle in it has already paid four times:
**for anything that reads somebody else's output, look at the real output before designing
around it.** Every fix below came from doing that instead of reasoning about it.

---

## Where this actually is

The fourth pass proposed four things to do next. One session later: **two were already
built, one is permanently blocked by somebody else's OAuth, and the fourth turned out to
have four bugs in it.** Nothing on the list was built as written.

What actually happened is that one line on the Now page —

> **Morning brief** — Its last 2 runs came to nothing.

— was followed to the bottom, and produced five commits:

- **`83cb48f`** the inbox pre-flight gated on `status === 'connected'`, which is not the
  question. A claude.ai connector reports Connected and hands an unattended run nothing;
  `pickInboxServer` now decides on `origin` first and refuses without spending. Cost $0.37
  to discover, which is exactly the charge that pre-flight exists to prevent.
- **`fb9e620`** a restart mid-run counted as the ritual failing. Three of those in a row
  and `GIVE_UP_AFTER` turns it off — so working on this app was a way to silently disable
  the briefing it runs every morning. The system already disagreed with itself:
  `resumeInterruptedRituals` puts the clock back to *retry* those exact runs.
- **`313ff4c`** a blocked run was offered "the one narrow rule it needed" even when no rule
  could help. Granting it says "Allowed. It will not stop for these again", the next firing
  is refused identically, and the only thing spent is another morning.
- **`cbac88b`** and **`e42da96`** a granted rule that can do nothing now says so, on both
  surfaces that draw permission chips — rituals, and the project grants a session turn runs
  with.

**One root cause, four surfaces, all now covered.** Every one of them was the same fact
wearing a different hat: a tool that exists for an interactive session does not exist for
an unattended one, and nothing in the app knew the difference.

New working rule, and this cycle earned it: **the app's own alarms are a better backlog
than this document.** Anything this app says needs you is a claim it is making about
itself. Checking one is cheaper than choosing a feature and more likely to pay — and on the
evidence of this session, much more likely to be about something real.

---

## What the fourth pass got wrong

**1. Three of its four "Now" items were not next.** "Close the loop between the halves"
was described as needing "the one button"; the button was already there — `work-on-inbox`
has been turning an inbox row into a session for a week. "The briefing as the front door"
was already the front door: `index.vue` composes the Now queue, NightShift and
WhileYouWereAway, and it is the first thing in the sidebar. Both were written by reading
the strategy documents rather than the app.

**2. It called inbox breadth "an evening's work with no code in it."** That was wrong in a
way worth keeping, because the reason is a hard boundary rather than an oversight — see
below.

**3. It was right about the thesis, and that is worth saying too.** The control plane
framing held: the unit is an obligation, not a session, and everything built since has been
about obligations. Sessions stayed demoted to "how an obligation gets discharged" and
nothing has argued otherwise.

---

## The boundary on unattended work, which is not ours to move

This is the most important thing found this cycle and it constrains the product
permanently, so it gets its own section rather than a bullet.

**An unattended run can only reach an MCP service that carries its own credentials.** Two
kinds qualify: a plugin server with a configured token (`plugin:slack:slack`), and an HTTP
server signed in with `claude mcp login` (`notion`). A claude.ai connector does not — its
OAuth belongs to the interactive session, whatever `claude mcp list` says.

**And the obvious workaround does not exist for Google.** Adding Calendar as its own HTTP
server, exactly the way Notion works, fails at the login:

> `claude mcp login gcal` → *"Incompatible auth server: does not support dynamic client
> registration"*

Notion's endpoint implements RFC 7591 and Google's does not. So Calendar, Gmail and Drive
are connector-only, and no configuration on this machine changes that. It is a property of
each vendor's authorisation server.

The consequences are real and should be planned around rather than rediscovered:

- **Inbox breadth is gated per vendor, not per evening.** Whether a source is reachable is
  decided by whether its MCP endpoint supports dynamic client registration. Notion yes,
  Slack yes via the plugin, Google no. Everything else is unknown until tried, and trying
  is two commands.
- **The morning briefing cannot be fully unattended.** `/hd:goodmorning` names Calendar as
  "the backbone the plan is laid against", and the backbone is out of reach. Unattended it
  can rank priorities and blockers from GitHub, Notion and Slack; it cannot lay them
  against the day. Run interactively it is the whole thing, because connectors work there.
- **So the briefing is two products.** A partial one that arrives before you get in, and a
  complete one you ask for. That is not a defeat, but pretending it is one product is how
  the ritual came to have four permanently dead rules on it.

The one door left, unopened deliberately: macOS Calendar holds the same events, already
expanded, and `icalBuddy` reads it. It needs a Homebrew install and TCC access for a
launchd service, which is a chain of uncertainties worth testing only if the missing
time-blocking starts to matter.

---

## The competitive picture, checked rather than assumed

Established in the fourth pass by actually looking, and kept here because it took the
looking and still decides what not to build.

| Claim | Checked |
| --- | --- |
| Desktop has parallel sessions on worktrees | **True, and more** — the April 14 2026 redesign has a multi-session sidebar, worktree isolation, drag-and-drop panes, and an integrated terminal *and* file editor |
| Worktrees are a Desktop feature | **False** — native in the CLI since v2.1.49, February 2026 (`claude -w`) |
| Routines are cloud-only and Team-plus | **False** — Pro, Max, Team and Enterprise, research preview; 15/day on Max |
| Routines only fire on a schedule | **False** — schedules, API calls and GitHub webhooks |
| Routines need GitHub | **True, and this is the durable gap** — GitHub repositories only, via the Claude GitHub App, executing in Anthropic's cloud |
| Self-hosted execution will close that gap | **Arrived Aug 6 2026 and does not** — Team and Enterprise only, off by default, and Anthropic tells you to expect a platform team to own the runner image |

Two conclusions, both still current. **The workbench argument was lost in April**, which is
why depth there is declined below rather than chased. And **the scheduling gap is narrower
than the README claims but realer than it feared**: "no scheduling" is simply false and
should come out of the launch drafts, but Routines run in Anthropic's cloud against GitHub
repositories, while everything here runs against a local working copy and anything
MCP-reachable — subject to the boundary above, which is the honest asterisk on it.

---

## Now

Ordered, and short on purpose — the last list was four items long and mostly already done.

### 1. Follow the alarms

The working rule of this cycle, made the plan. The app is currently saying, unprompted:
**12 worktrees waiting to restore**, 20 workspaces on disk, 33 sessions in other projects,
and a conflicted pull request from **April 20** still sitting in the queue as needing you.

Each is a claim the app is making about itself, and on this cycle's evidence roughly one in
two is a real defect rather than a true report. The April pull request is the most
interesting: either it genuinely needs you four months on, or the queue has a notion of
"needs you" that never expires, which would be a slow leak in the one screen that has to
stay trustworthy.

### 2. Make the next Morning brief run count

**Settled: it ran on 17 August, `ok`, $1.67, and the streak is broken.** The ritual
survives and the permission work behind it held.

What it exposed instead was the next thing, and it was sitting in plain sight — the run
came back complete-looking and was *not* complete. Its first three lines were
`[SKIP] Google Calendar`, `[SKIP] Gmail`, and `[SKIP] Notion tasks DB — workspace hit its
Query Data Source usage limit mid-pull`, and one of the six priorities it then ranked came
from Notion. The digest filed it as "1 scheduled run went through without trouble", because
nothing was denied and nothing was refused: **every other kind of half-done run is visible
from outside it, and this one is only ever written down in prose.** Now read off the
output, and the promotion condition on the partial-briefing bet turned out to be this run
rather than a future one.

### 3. Watch what the skips turn out to be

Two of the three are the vendor boundary above and will skip every morning for good.
The third — a Notion workspace hitting a query limit *mid-pull* — is a different animal:
transient, silent, and it truncates rather than fails. It is deliberately not counted in
"needs you" yet, because a badge permanently at 2 is a badge nobody reads. **If a source
starts skipping most mornings, that is a ritual quietly degrading and the schedules page is
where it should say so** — which is a bet below rather than work now.

### 4. Gate and governor, still infrastructure

Unchanged from the fourth pass and now with evidence behind it. Check verdicts that expire,
the failing streak, spend caps, the sandbox, ordered landing. They do not need features;
they need to keep working. Four of this cycle's five commits were defects in exactly this
layer, and a regression here is a P1 in a way a missing inbox source is not.

---

## Deliberately not doing

**Workbench *depth*.** Find-in-file, bracket matching, a diff viewer, arrangeable panes.
Desktop shipped all of it in April and does it better.

**The panes themselves stay, and that is decided rather than drifted into.** The editor,
the shell and the preview earn their place: the loop they close is *this* app's loop —
read what a session did, change one line, re-run the checks, land it — and a Cmd-Tab to
Desktop closes a different loop that ends somewhere else, with the verdict and the merge
gate left behind. What is declined is chasing Desktop *within* them.

**Chasing connector-only services into the unattended half.** Handling OAuth tokens
ourselves to reach Google would mean holding a refresh token, renewing it hourly, and
storing a credential this app has never stored. The boundary above is somebody else's
authorisation server, and the honest answer is to say which sources are unattended and
which are interactive.

**The launch.** A chore, not a gate. The drafts in `docs/launch/` are stale in a specific
way: they lead with parallel sessions, which Desktop shipped in April, and claim Desktop
has no scheduling, which Routines disproved in April too. The ten-minute version — repo
description, topics, Discussions — is the whole cost of leaving the door open, and the
pinned roadmap issue is now several passes out of date.

---

## Bets, and what would settle each

Promotion conditions are things *you* will notice, since no stranger is coming to say them.

| Bet | Promote it when |
| --- | --- |
| **Inbox sources beyond Notion and Slack** | The first morning you check something by hand *after* reading the queue. Bounded by the vendor boundary above, so the next candidate is whichever service supports dynamic client registration |
| **Configuration that travels through git** — rituals and checks committed to the repo | You want the same ritual in a second repository and copy it by hand. Still a file format, not a server |
| **Which rituals earn their cost** | The spend page tells you a number you cannot attribute. Not urgent while rituals are cheap; urgent the moment scheduled inbox refreshes are on for several sources |
| **Landing without colliding** — teammates' open branches, not only our own sessions | The first landing that conflicts with something a colleague pushed. Likely, now that this is pointed at a work monorepo |
| **A source that keeps going missing is the ritual degrading** — skips counted across firings, on the schedules page beside the failing streak | The first time you read the same `[SKIP]` for a week and it is a transient one. A connector that is permanently out of reach is not this; a Notion query limit hit most mornings is |

One debt still demoted: **storage that survives concurrency.** Flat JSON remains right for
one person on one machine. It comes back if the run queue corrupts it, and not before.

---

## Shipped

Parallel sessions on worktrees · project checks gating merges · sessions that repair their
own failing checks · verdicts that expire when the base moves · ordered landing of several
finished sessions · rituals that retry once and stop when they have clearly broken ·
sandboxed runs that name the host they were refused · rituals that fire when a PR opens or
CI goes red · the rate limit shown beside the spend and enforced against unattended work ·
a skipped ritual saying so · permission handling for unattended runs · spend tracking and
hard limits · multi-repository projects · MCP management · GitHub skill import ·
marketplace and plugin install · workflow builder · relationship graph · backups · editing
a file without leaving the session · a real shell in the workspace · running the session's
app and looking at it · rewind, guarded at the branch point · one pane at a time · choosing
how far a session is trusted before it starts · following the pull request after it is
opened · rituals that are a chain of steps, counted as one firing · rituals that fire when
an issue is labelled or a review is requested · picking a branch or pull request from what
exists · the pull requests waiting on you and the ones you opened, each one press from a
session · one screen for what needs you · an inbox over Notion and Slack with the discovery
cached so a refresh costs $0.38 rather than $1.39 · agents, commands and skills as one
library · sessions and runs as one Work list · ⌘K that does things · the night as a picture
· the order six branches will land in, drawn.

**Since**: **a run that reached three of its six sources no longer reports as trouble-free**
— the `[SKIP]` lines it wrote about itself are read, named, and said to mean *missing rather
than empty*, which is the difference between "Slack is quiet" and never having asked Slack.

**This cycle**, all of it from following one alarm: **an inbox source that says Connected
and cannot answer is refused before it costs anything** · **a restart no longer counts as
the ritual breaking** · **a blocked run is no longer offered a rule that cannot help it** ·
**a granted permission that can do nothing says so, on rituals and on projects** · **the
Work page stopped spending its first screen explaining itself**.

---

## Still not planned

- **Mobile, remote access, authentication, hosted mode.** One person, one machine. The
  tension worth naming: the manager half of the job is not always at a desk, and
  `HOST=0.0.0.0` with its documented threat model is the whole answer for now.
- **Webhooks.** Opening a port to the internet is a different product with a different
  threat model. Polling asks the same question from inside.
- **Non-Claude model backends.** Several third-party tools are multi-model. That was a
  competitive weakness and is now simply irrelevant: this runs what its author pays for.
- **Telemetry.** Refused on principle, and now also pointless — there is one user and he
  can be asked directly.
