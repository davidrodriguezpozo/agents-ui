# GitHub issue: what's next

Post this **after** the launch threads are up, and pin it. It's what people check when
they're deciding whether a new repo is alive.

**Title:** Roadmap — what's next, and what would help you most

**Labels:** `roadmap`, `discussion` (pin the issue)

---

**Body:**

## Where this is

Everything below the line already works, so this is a roadmap rather than a wishlist.
If you're arriving from a launch thread, the [README](../../README.md) is the tour.

**Shipped:** parallel sessions on worktrees · project checks gating merges · scheduled
rituals with permission handling · spend tracking and hard limits · multi-repository
projects · GitHub skill import · marketplace browsing and plugin install · workflow
builder · relationship graph · backups · dark mode · `npm i -g agents-studio`.

## Next

- **MCP server management** — add, inspect and scope MCP servers from the UI. The most
  obvious gap; `.claude`'s MCP config is currently read-only here.
- **Rituals that finish the job** — retry with the failure in context rather than just
  recording a red run, and chaining, so triage → fix → PR is one ritual instead of three.
- **Storage that survives concurrency** — sessions and rituals are flat JSON files today.
  Fine for one person on one machine; not fine for anything beyond that, and it's the
  thing blocking a shared/hosted mode.

## Ideas, not commitments

Comment if one of these is the thing you actually want — that's mostly how the order
gets decided.

- Shared or hosted mode, so a team watches one fleet (needs the storage work first)
- Which agents and rituals are actually earning their cost, over time
- Session templates — the same five-way fan-out you run every week, saved
- A read-only view you can leave open on a second monitor

## Not planned

- Non-Claude model backends. Everything here runs through the Claude Agent SDK and the
  login you already have; a provider abstraction would be a different project.
- Any telemetry.

---

**Which of these would change your week?** Say so below, with what you'd use it for —
concrete use cases move things up the list much faster than upvotes do.

New contributors: [CONTRIBUTING.md](../../CONTRIBUTING.md), and issues tagged
`good first issue`.
