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
rituals that retry and stop once they've broken · sandboxed runs, on by default, that
say which host they were refused · permission handling for unattended runs · spend
tracking and hard limits · your rate limit shown beside what it cost, and unattended
work held back when you're near it · rituals that fire when a PR opens or CI goes red,
not only on a clock ·
multi-repository projects · MCP servers added, scoped and signed into from the UI ·
GitHub skill import · marketplace browsing and plugin install · workflow builder ·
relationship graph · backups · dark mode · `npm i -g agents-studio`.

### Sandboxing is on by default

Worth calling out separately, because it changes what already-configured projects do.
Commands a run decides to execute go through a sandbox: no network beyond the hosts you
list, and no letting itself back out. That applies to projects set up before the setting
existed, not only to new ones — the people already leaving rituals running unattended
are exactly who it is for.

If your project already has rituals that have run before, the Daily page says all this
before anything breaks, once, and then stops mentioning it.

If a ritual of yours starts failing on a host it used to reach, it says so: the run is
marked as needing you rather than quietly reported as finished, names the host it could
not get to, and offers to allow just that host for that project. The full list, and a
switch that turns the sandbox off entirely for a project, are in
**Settings → What a run may touch**.

### Rituals can fire on events, not only on a clock

A pull request opening, or a workflow run failing — optionally narrowed to one branch.
Checked every couple of minutes with `gh`, using the login you already have; nothing is
opened to the internet.

It starts from when you save it. Turning on "when a pull request is opened" against a
repository with nine already open does not start work on all nine — it takes note of
where things stand and fires on what happens next.

## Who this is for

Solo developers, working in small teams. One person, one machine, one instance — that's
the design, not a step towards a hosted one. It stays on `127.0.0.1` with no
authentication in front of it, and the team half of that sentence is about configuration
that travels through git rather than about several people sharing a server.

## What's next — genuinely undecided

This list is deliberately not in order. There's no telemetry here and there never will
be, so the only thing that will ever tell me what to build next is what people say. Each
of these is written with the thing you'd have to tell me for it to jump the queue.

- **More things a ritual can fire on** — an issue labelled, a review requested, a comment
  that mentions you. Two exist today, so *"I want it to fire on X"* is the likeliest ask.
- **Telling event runs apart** — a ritual that fires on five pull requests currently
  produces five identically-named rows. Say so if that's annoying in practice.
- **Rituals that chain** — triage → fix → verify → open a PR as one ritual with one
  health record, rather than three that don't know about each other. Promoted by *"I've
  got three rituals that need to know about each other"*.
- **The PR after the merge** — we can open one, then we forget it. Watch it, react to a
  red CI run or a review comment, land it when it goes green.
- **Configuration that travels through git** — rituals, check commands and setup commands
  committed to the repository, so a teammate who clones it gets them too. Promoted by
  anyone describing a second person working in the same repo.
- **Landing that knows about your teammates' open branches**, not just your own sessions.
- **Which agents and rituals are actually earning their cost**, over time.
- **Session templates** — the same five-way fan-out you run every week, saved.

## Not planned

- **Mobile, remote access, authentication, or a hosted mode.** This runs on your machine
  as you, against your repositories, and stays there.
- **An integrated terminal, file editor, live preview or rewind.** Claude Code Desktop is
  the workbench and is better at it than this would be.
- **Non-Claude model backends.** Everything here runs through the Claude Agent SDK and
  the login you already have; a provider abstraction would be a different project.
- **Any telemetry.**

---

**Which of these would change your week?** Say so below, with what you'd use it for —
concrete use cases move things up the list much faster than upvotes do.

New contributors:
[CONTRIBUTING.md](https://github.com/davidrodriguezpozo/agents-ui/blob/main/CONTRIBUTING.md),
and issues tagged `good first issue`.
