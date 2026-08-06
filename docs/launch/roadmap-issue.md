# GitHub issue: what's next

Pin it once posted. It's what people check when they're deciding whether a new repo is
alive — which means it has to stay true. Refresh it whenever something on **Next** ships.

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
that fix their own failing checks · scheduled rituals that retry and stop once they've
broken · permission handling for unattended runs · spend tracking and hard limits ·
multi-repository projects · GitHub skill import · marketplace browsing and plugin
install · workflow builder · relationship graph · backups · dark mode ·
`npm i -g agents-studio`.

## Next

- **MCP server management** — add, inspect and scope MCP servers from the UI, and see
  which tools each one brings. The most obvious gap: `.claude`'s MCP config is read-only
  here today. This is the top of the list.
- **Workflows worth using** — the builder chains agents and resolves each step to a real
  model, but running one is thinner than it should be. Better inspection of what each
  step did, and failure handling that doesn't lose the run.
- **Rituals that chain** — triage → fix → open a PR as one ritual rather than three
  that don't know about each other.
- **Storage that survives concurrency** — sessions and rituals are flat JSON files.
  Fine for one person on one machine; not fine for anything beyond that, and it's the
  thing blocking any shared or hosted mode.

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

New contributors:
[CONTRIBUTING.md](https://github.com/davidrodriguezpozo/agents-ui/blob/main/CONTRIBUTING.md),
and issues tagged `good first issue`.
