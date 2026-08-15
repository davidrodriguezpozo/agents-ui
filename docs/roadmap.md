# Roadmap

Fourth pass, August 2026, written at 0.5.3. Against Claude Code 2.1.224, the Desktop
redesign of April 2026, and the self-hosted environments beta of August 2026. The third
pass is in git history and worth reading — most of it holds, and the parts that do not are
named below rather than quietly dropped.

## The audience is one person, and that is now a decision

The first three passes were written as though strangers were about to arrive. They were
not, and the third pass spent its opening section proving it with a download curve.

**This one starts from the opposite premise: the user is the person writing it.** The tool
exists to make one engineer, tech lead and manager materially faster at those three jobs.
If other people find it useful, good — the repository stays public, the licence stays MIT
— but nothing on this page is chosen because it might attract them.

That retires a great deal:

- The download curve stops being a scoreboard. It was never measuring anything but the
  publish log anyway.
- The launch checklist stops being *blocking*. It becomes a chore worth an hour, some day.
- The "no evidence" problem dissolves. There is evidence, it arrives daily, and it is the
  question *did this save me time this week*.

It retires nothing about rigour. The working rule from the last three cycles holds and is
worth restating, because under a one-person audience it is the only quality gate left:
**for anything that reads somebody else's output, look at the real output before designing
around it.** That rule is what took an inbox refresh from $1.39 to $0.38. Losing an
audience is not a licence to lose that.

---

## Where this actually is

Eleven releases between 0.2.0 and 0.5.3, in five days. Seventy-three commits: 22 fixes, 10
features, 6 builds, 2 performance. The fix-to-feature ratio is the shape of a product being
used hard by one person, which is exactly what it is.

**The third pass and the week that followed it disagree about what this product is, and the
week is right.**

The third pass says this is a **gate, a governor and a health record** for unattended
coding work. Every one of its four forward bets is about sessions, rituals, landing order
and merge safety.

The week built something else:

- an **inbox** spanning Notion and Slack, over MCP, with per-source cost, dismissals and
  scheduled refresh (`feat: work waiting elsewhere`)
- **one screen for what needs you** — the Now queue, ahead of everything else in the
  sidebar (`feat: one screen for what needs you`)
- **Reviews** pointed at a command of your own, pull requests one press from a session
- **⌘K that acts** rather than only finding
- the inbox refresh made four times cheaper, which is what made a *scheduled* refresh a
  defensible thing to offer at all

**The third pass does not mention the inbox once.** It is the newest and most-invested
surface in the app, and it is absent from the document that was supposed to be deciding
what got built. That is not a small oversight; it is the thesis being out of date and the
hands knowing before the plan did.

New working rule, and this cycle earned it: **when the strategy document does not mention
the surface you spent the week building, the document is what is wrong.**

---

## What the third pass got wrong

**1. It treated the launch as the gate.** "Build the answer, then launch" put seven items
in front of a Show HN that was never going to happen, and five days later not one of the
six blocking checklist items had moved while eleven releases went out. That is not
weakness of will. It is what happens when the plan's next step is something the author does
not actually want, and the honest fix is to stop calling it the next step.

**2. It picked the wrong differentiator to defend.** The nine rows of the README comparison
table are all forms of *policy about whether work should land*. They are a real lead and
they are not a moat — Anthropic could ship every one. Defending them was a competitive
argument, and there is no longer a competition to win.

**3. It analysed only Anthropic.** Zero mention of the third-party field, which turns out to
be busy: Nimbalyst (formerly Crystal), `parallel-code`, `ccmanager`, several of them
multi-model. Under the old framing that was a blind spot. Under the new one it is a
purchasing decision that has already been made, and its only consequence is *do not build
there*.

---

## The competitive picture, checked rather than assumed

The third pass asserted these from memory. They are now checked, with dates, because two of
them had moved and one had moved further than the document feared.

| Claim | Checked |
| --- | --- |
| Desktop has parallel sessions on worktrees | **True, and more.** The April 14 2026 redesign has a multi-session sidebar, worktree isolation, drag-and-drop panes, three view modes, side chat, and an **integrated terminal and file editor** |
| Worktrees are a Desktop feature | **False.** Native in the CLI since v2.1.49, February 2026 — `claude -w` |
| Routines are cloud-only and Team-plus | **False.** Pro, Max, Team and Enterprise, research preview. 15/day on Max, drawing down the same subscription limits |
| Routines fire on a schedule | **True, and on API calls and GitHub webhooks** — so the event triggers are not unique either |
| Routines need GitHub | **True, and this is the durable gap.** GitHub repositories only, via the Claude GitHub App, executing in Anthropic's cloud |
| Self-hosted execution is coming and will close the gap | **Arrived Aug 6 2026, and does not close it.** Public beta, **Team and Enterprise only**, off by default, and Anthropic tells you to expect a platform team to own the runner image and orchestrator |

Two conclusions, both of which change what gets built:

**The workbench argument is over and it was lost in April.** The absorb-the-workbench cycle
— editor, shell, dev server in the page — built toward parity with something Desktop had
already shipped. The third pass's "deliberately not doing: workbench depth" was right, and
it should now go further: those panes are a maintenance cost with a better free
alternative one Cmd-Tab away.

**The scheduling gap is narrower than the README claims and realer than the README
fears.** "No scheduling" is simply false and should come out of the launch drafts. But
Routines run in Anthropic's cloud against GitHub repositories. Everything this tool
schedules runs against a **local working copy** and anything MCP-reachable — no GitHub App,
no push required, no cloud. And self-hosting is not available on an individual plan and
will not be soon. That gap is not closing; it is the one to build on.

---

## Now — the control plane

The unit this app is organised around should stop being *a session* and become *an
obligation*: a thing that needs you, from wherever it came from, with one press to
discharge it.

That is not a pivot. It is what the last week built, given a name — and it puts the Now
queue and the inbox at the centre where they already are in use, with sessions demoted from
"the product" to "how an obligation gets discharged".

### 1. Inbox breadth — and the thing actually blocking it

Notion and Slack today. The obligations of the actual job also arrive from Linear or Jira,
HubSpot, the calendar and email.

**The code half is done and was checked rather than assumed.** `inboxRefresh.ts` has no
per-source branching at all: it is driven entirely by the `InboxSource` record, so a new
source really is a config entry and a prompt. The expensive part is solved too — the first
Notion refresh cost $1.48 and 82 seconds, almost none of it the query, and caching that
derivation is the pattern every new source inherits.

**What blocks breadth is MCP setup, and it is not what `claude mcp list` says it is.** Of
the services on this machine, Linear, Jira, HubSpot, Asana, monday.com and Intercom all
report *Needs authentication*. Gmail, Google Calendar and Google Drive report **Connected**
— and are unusable anyway:

> `claude mcp list` → `claude.ai Gmail: ✔ Connected`
> `claude -p --allowedTools mcp__claude_ai_Gmail` → zero tools, *"The following MCP servers
> require authentication before their tools can be used: claude.ai Gmail"*

Google Calendar did the same. **A claude.ai connector's OAuth belongs to the interactive
session and a headless run inherits none of it.** The two sources that work are both the
other kind — `notion` is a user-scoped HTTP server and `plugin:slack:slack` is a plugin —
and each carries its own credentials rather than borrowing a session's.

That cost $0.37 to find out, which is precisely the charge the pre-flight exists to
prevent, because it gated on `status === 'connected'`. Fixed: `pickInboxServer` decides on
`origin` before `status`, refuses a connector without spending, and says what to do
instead. The working rule paid for the fourth cycle running, and this time it found a bug
in shipped code rather than in a design.

**So the route to a new source is a setup step, not a feature:** add the service as its own
user-scoped HTTP server and `claude mcp login` it — exactly how Notion is set up — then add
the config entry. The app can already do both halves; the MCP page has the add form and the
sign-in button. Linear is the obvious first one, and it is an evening's work with no code
in it.

### 2. The briefing as the front door

`digest.ts`, `NightShift` and `WhileYouWereAway` already exist and are the closest thing
here to the actual product. A tech lead's 08:00 is: what broke overnight, what is waiting
on me, what my team is blocked on, what I said I would do.

**This is the one thing Routines structurally cannot do**, and it is worth being precise
about why: it needs local repositories, Slack and Notion in the same run, on a machine that
holds all three sets of credentials. A cloud routine against a GitHub repository cannot
assemble it.

### 3. Close the loop between the halves

The inbox knows what needs you. Sessions know how to do work. Today those are two screens
and a copy-paste.

"This PR needs review" → a session that reviews it against your standards → **posts nothing
until you say so.** The prompt discipline for this already exists and is right: all four
Reviews prompts end by refusing to post under your name, and merging is the single
exception, asked twice, only on your own pull request, only on a fresh read.

Most of this is built. What is missing is the one button.

### 4. Gate and governor, demoted to infrastructure

Check verdicts that expire when the base moves, the failing streak, spend caps, the
sandbox, ordered landing. **These stay, and they stop being the headline.** They are what
makes the unattended half trustworthy enough to leave alone. They do not need features;
they need to keep working, and a regression in any of them is a P1 in a way that a missing
inbox source is not.

---

## Deliberately not doing

**Workbench *depth* — now with a stronger reason.** Find-in-file, bracket matching, a diff
viewer, arrangeable panes. Desktop shipped all of it in April and does it better. The
absorb bet was always narrow — you never have to leave a session's workspace to finish its
work — and that bar is met. Editing one line and re-running the checks works today.

**The panes themselves stay, and that is decided rather than drifted into.** The editor,
the shell and the preview earn their place: the loop they close is *this* app's loop —
read what a session did, change one line, re-run the checks, land it — and a Cmd-Tab to
Desktop closes a different loop that ends somewhere else, with the verdict and the merge
gate left behind. What is declined is chasing Desktop *within* them. They stay as they are:
enough to finish a piece of work without leaving, and no more.

**The launch.** Demoted from blocker to chore. `docs/launch/` stays; the drafts are stale
in a specific way — they lead with parallel sessions, which Desktop shipped in April, and
they claim Desktop has no scheduling, which Routines disproved in April too. Anyone posting
them as written would be corrected in the first three replies and would deserve it.

The one exception, worth ten minutes some evening: the repo description still sells the
March pitch, Discussions are off, and there are no topics. That is the entire cost of
leaving the door open for the "if others find it useful" case. It is not a cycle.

---

## Bets, and what would settle each

The third pass gated every bet on a sentence a stranger might say. No stranger is coming,
so those conditions could never fire and the table was un-actionable by construction.
Rewritten as things *you* will notice, which is a signal that actually arrives.

| Bet | Promote it when |
| --- | --- |
| **Inbox sources beyond Notion and Slack** | The first morning you check Linear or the calendar by hand *after* reading the queue. That is the queue failing at its one job |
| **Configuration that travels through git** — rituals and checks committed to the repo | You want the same ritual in a second repository and copy it by hand. Still a file format, not a server — and now also the honest path to a teammate using it |
| **The briefing as the front door** | Any week you open the app and go somewhere other than Now first. That means the front door is in the wrong place |
| **Which rituals earn their cost** | The spend page tells you a number you cannot attribute. With rituals cheap this is not urgent; it becomes urgent the moment scheduled inbox refreshes are on for four sources |
| **Landing without colliding** — teammates' open branches, not only our own sessions | The first landing that conflicts with something a colleague pushed. Genuinely likely now that this is pointed at a work monorepo |

One debt still demoted: **storage that survives concurrency.** Flat JSON remains the right
design for one person on one machine. It comes back if the run queue actually corrupts it,
and not before. Eight parallel sessions made every page slow this cycle and the fix was not
the storage engine.

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
opened — fixing red CI and landing it when green · rituals that are a chain of steps,
counted as one firing · rituals that fire when an issue is labelled or a review is
requested · picking a branch or pull request from what exists, rather than typing it · the
pull requests waiting on you and the ones you opened, each one press from a session that
knows why it is there.

**This cycle**, and the reason the thesis changed: **one screen for what needs you** · **an
inbox over Notion and Slack, on MCP, with the discovery cached so a refresh costs $0.38
rather than $1.39** · **work waiting elsewhere folded into the same queue** · **agents,
commands and skills as one library** · **sessions and runs as one Work list** · **rows you
can take off that list without losing what they recorded** · **⌘K that does things rather
than only finding them** · **a Reviews quick action pointed at a command of your own** ·
**the night as a picture** · **the order six branches will land in, drawn** · **a skill
treated as the directory it actually is**.

---

## Still not planned

- **Mobile, remote access, authentication, hosted mode.** One person, one machine. The
  tension worth naming: a briefing you cannot read from a phone is a briefing you read at a
  desk, and the manager half of the job is not always at a desk. `HOST=0.0.0.0` exists and
  is documented with its threat model. That is the whole answer for now, and "read the
  digest on your phone" is the first thing that would ever justify revisiting it.
- **Webhooks.** Taking them means opening a port to the internet — a different product with
  a different threat model. Polling asks the same question from inside.
- **Non-Claude model backends.** Several of the third-party tools are multi-model. That was
  a competitive weakness and is now simply irrelevant: this runs what its author pays for.
- **Telemetry.** Previously refused on principle. Now also pointless — there is one user and
  he can be asked directly.
