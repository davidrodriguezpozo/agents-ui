# 20 · The always-on runner

**Wave** 8 · **Depends on** 16 · **Hot file** a new `docs/` page
**Done when** somebody can follow one document and end up with a machine that runs rituals
overnight without anyone's laptop being awake.

## Why

Every scheduled thing in this app currently depends on a laptop being open. A small Linux box
or a Mac mini fixes it, and pairs with rather than fights Anthropic's self-hosted runners:
same idea one layer down, with this app as the thing that decides what is worth running.

## Build

- Read the `service` targets in the `Makefile` and `bin/start.mjs` first — most of this
  exists and the document's job is to make it followable.
- Cover: install as a service, `CLAUDE_DIR` and where state lives, `HOST` and what binding
  beyond loopback actually means, backups pointed somewhere off the machine, which repos it
  checks out, how it authenticates to GitHub, and how spend is capped there specifically.
- Name the failure modes plainly: an expired login, a full disk of worktrees, a machine that
  rebooted and never restarted the service, and where each is visible.
- Anything the document cannot honestly claim yet goes under `## Findings` as a gap, not as
  a paragraph of hope.

## Acceptance

- Follow it on a second machine, or a container, from a clean state. Anything you had to work
  out yourself is a bug in the document.
- `make check` green.

## Out of scope

Building anything. This is the document; code gaps it finds become their own briefs.
