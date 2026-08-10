# GitHub issue: what's next

Pin it once posted. It's what people check when they're deciding whether a new repo is
alive — which means it has to stay true. Refresh it whenever something on **Next** ships,
and regenerate it from [../roadmap.md](../roadmap.md) whenever that changes.

**Title:** Roadmap — what's next, and what would help you most

**Labels:** `roadmap` (pin the issue)

Links must be absolute: an issue body does not resolve repository-relative paths.

---

**Body:**

## Where this is

Everything under *Shipped* already works, so this is a roadmap rather than a wishlist.
If you're arriving from a launch thread, the
[README](https://github.com/davidrodriguezpozo/agents-ui#readme) is the tour.

**Shipped:** parallel sessions on worktrees · project checks gating merges · sessions
that fix their own failing checks · verdicts that expire when the base moves under them ·
landing several finished sessions in an order that accounts for each other · scheduled
rituals that retry and stop once they've broken · a skipped ritual saying so rather than
vanishing · sandboxed runs, on by default, that say which host they were refused ·
permission handling for unattended runs · spend tracking and hard limits · your rate
limit shown beside what it cost, and unattended work held back when you're near it ·
rituals that fire when a PR opens or CI goes red, not only on a clock · **rituals that
are a chain of steps** · **following the PR after you open it** · editing files, a real
shell, your app running in the page, and rewind — all inside the session's workspace ·
choosing how far a session is trusted before it starts · multi-repository projects · MCP
servers added, scoped and signed into from the UI · GitHub skill import · marketplace
browsing and plugin install · workflow builder · relationship graph · backups · dark
mode · `npm i -g agents-studio`.

### What it's actually for

Starting an agent on a timer is the easy half — `cron` and a shell script get you there,
and Claude Code Desktop gives you sessions on worktrees. This is the other half: what
happens *after* it runs, when nobody is watching.

A run that fails your test suite doesn't merge, and a pass from before the base moved
doesn't count. A run that fails fixes itself, up to a limit you set, then stops. A ritual
that's failed three mornings running turns itself off instead of failing every morning
forever. Several finished branches land in an order that accounts for each other. A daily
spend cap skips the work rather than billing you for it. An unattended run reaches only
the hosts you listed, and says which one it was refused.

That's the part you end up hand-rolling once a scheduled agent has merged something red
at 3am.

### Following the pull request after you open it

Opening one used to be where it ended. CI runs somewhere else, against a merge with your
base that never happened locally, so it goes red for reasons your workspace couldn't have
known — and the branch sits there until you notice.

A session can now keep watching: it reads the checks GitHub actually ran, hands a red
result back to the session that wrote the code, pushes the fix, and merges when it comes
good. Bounded at three attempts and checked against your spend cap.

Landing is opted into separately from watching, every time. Fixing red CI pushes to a
branch that's already yours; merging is the one thing here other people see, and nothing
in the app can take it back. It also never merges a pull request that reported *no*
checks at all — passing nothing isn't passing.

### Rituals can be a chain of steps

Triage → fix → verify → open a PR, as one ritual rather than four that don't know about
each other. Each step is told what the last one produced, and it stops at the first step
that doesn't work.

The steps get a row each, so you can see what each one did — but the *ritual* counts them
as one firing. One bad night is one failure, not four, which matters because three
failures in a row is what turns a ritual off.

### Rituals can fire on events, not only on a clock

Four of them: a pull request opening, a workflow run failing, an issue labelled, or a
review requested — each narrowed by the thing that makes sense for it, so a branch, a
label, or the person or team asked. Checked every couple of minutes with `gh`, using the
login you already have; nothing is opened to the internet.

It starts from when you save it. Turning on "when a pull request is opened" against a
repository with nine already open does not start work on all nine — it takes note of
where things stand and fires on what happens next.

One poll looks back fifty items, which covers a weekend rather than a fortnight. If more
happened than that while your machine was off, it says so instead of quietly carrying on
— on the ritual and in the morning report.

## Who this is for

Solo developers, working in small teams. One person, one machine, one instance — that's
the design, not a step towards a hosted one. It stays on `127.0.0.1` with no
authentication in front of it, and the team half of that sentence is about configuration
that travels through git rather than about several people sharing a server.

## What's next — genuinely undecided

This list is deliberately not in order. There's no telemetry here and there never will
be, so the only thing that will ever tell me what to build next is what people say. Each
of these is written with the thing you'd have to tell me for it to jump the queue.

- **A ritual that fires when a comment mentions you.** Wanted, and not built yet for an
  honest reason: GitHub's repository event log records that *a* mention happened but not
  *who* was mentioned, so a trigger built on it would fire on every mention of anybody.
  Doing it properly needs a different source and its own way of tracking what it has
  already seen. Say so if you'd use it and it moves up.
- **Other things a ritual could fire on** — four exist today. *"I want it to fire on X"*
  is still the likeliest ask.
- **Configuration that travels through git** — rituals, check commands and setup commands
  committed to the repository, so a teammate who clones it gets them too. Promoted by
  anyone describing a second person working in the same repo.
- **Landing that knows about your teammates' open branches**, not just your own sessions.
- **Which agents and rituals are actually earning their cost**, over time.
- **Session templates** — the same five-way fan-out you run every week, saved.

One known debt, which needs no vote:

- **A laptop that was shut.** An overdue ritual is now reported rather than silently
  skipped, but whether it should still *run* when you open the lid is an open question —
  a briefing about this morning is worth less at 14:00 than a triage run is.

## Not planned

- **Mobile, remote access, authentication, or a hosted mode.** This runs on your machine
  as you, against your repositories, and stays there.
- **Webhooks.** Taking them means opening a port to the internet, which is a different
  product with a different threat model. Polling asks the same question from inside.
- **Non-Claude model backends.** Everything here runs through the Claude Agent SDK and
  the login you already have; a provider abstraction would be a different project.
- **Any telemetry.**

### A reversal worth naming

This list used to say an integrated terminal, file editor, live preview and rewind were
not planned, because Desktop is the workbench and is better at it. All four have since
shipped, and the reasoning changed rather than being quietly dropped: **people don't run
two things.** A tool you only open when something is wrong has to be worth opening, and
the way it becomes worth opening is that you can finish the work in it.

It's deliberately narrow — the goal is that you never have to *leave* a session's
workspace to finish its work, not that this becomes a better editor than Desktop. It
isn't one. There's no bracket matching, no find-in-file, no debugger. If the editor is
the reason you alt-tab away, that's worth telling me.

---

**Which of these would change your week?** Say so below, with what you'd use it for —
concrete use cases move things up the list much faster than upvotes do.

New contributors:
[CONTRIBUTING.md](https://github.com/davidrodriguezpozo/agents-ui/blob/main/CONTRIBUTING.md),
and issues tagged `good first issue`.
