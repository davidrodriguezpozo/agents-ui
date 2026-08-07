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
tracking and hard limits · holding unattended work back when you're near your rate
limit ·
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

## Who this is for

Solo developers, working in small teams. One person, one machine, one instance — that's
the design, not a step towards a hosted one. It stays on `127.0.0.1` with no
authentication in front of it, and the team half of that sentence is about configuration
that travels through git rather than about several people sharing a server.

## Next

- **Your rate limit on the spend page** — the limit itself is now readable and can hold
  unattended work back (see below), but the page you'd actually visit to ask "how am I
  doing" still shows only dollars.
- **Rituals that fire on an event** — a PR opened, a check run failed, an issue
  labelled, as well as on a clock.
- **Rituals that chain** — triage → fix → verify → open a PR as one ritual with one
  health record, rather than three that don't know about each other.
- **The PR after the merge** — we can open one, then we forget it. Watch it, react to a
  red CI run or a review comment, land it when it goes green.
- **Configuration that travels through git** — rituals, check commands and setup
  commands committed to the repository, so a teammate who clones it gets them too.

## Ideas, not commitments

Comment if one of these is the thing you actually want — that's mostly how the order
gets decided.

- Landing that knows about your teammates' open branches, not just your own sessions
- Which agents and rituals are actually earning their cost, over time
- Session templates — the same five-way fan-out you run every week, saved
- Reasoning effort per ritual, not just which model
- A read-only view you can leave open on a second monitor

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
