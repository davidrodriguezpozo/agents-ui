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

## Findings

**`docs/always-on.md`, linked from the README.** Most of it existed as code and as
`make` targets and nowhere as prose, which is what the brief said: the job was to
make it followable rather than to build anything. Eight sections — prerequisites,
install, `CLAUDE_DIR` and where state lives, `HOST` and what binding beyond loopback
means, which repositories it checks out and how it authenticates to GitHub, capping
spend, the four failure modes, backups — and then a closing section of gaps.

**It was followed from a clean state, in `node:22-slim`, and following it found three
defects.** Not reviewed, run:

1. **The port refusal names a command an npm install does not have.** It prints `make
   service PORT=3001`; from a global install the equivalent is `agents-studio install
   PORT=3001`. A one-line fix in `bin/start.mjs` and a brief of its own — the document
   gives both forms in the meantime.
2. **"Names the occupant" was a claim the document could not keep.** `portHolder`
   needs `lsof`; without it the refusal is correct and anonymous. Softened to say so,
   because a reader who gets no name should not think the refusal is broken.
3. **`install` is not atomic when there is no supervisor.** In a container it fails at
   `systemctl refused to start it` *after* copying the build, so `status` reports a
   deployed build for a service that was never registered. Documented, with the
   command to run the copied build under whatever supervisor the machine does have.

**And it confirmed four claims that would otherwise have been assertions.** The unit
file really does carry `Environment=PATH=…`, `PORT` and `HOST`; `CLAUDE_DIR` really is
absent from it unless it was set at install time, and present when it was; the server
binds and answers `200` on a box with **no `git`, no `claude` and no `gh`**; and the
default really is `HOST=127.0.0.1`.

That last one is the most useful thing the container taught: a machine missing every
prerequisite in §1 installs, starts and answers perfectly, and the absence only
surfaces when the first ritual fails. The document says so now, as an observation
rather than a warning.

**What the container could not prove, and is named in the document as a gap:** the
supervisor half. launchd does not exist there and systemd is not usable in a plain
container, so `RunAtLoad`, `KeepAlive`, `Restart=always` and — most importantly —
`loginctl enable-linger` are all read from the definitions the installer writes rather
than watched surviving a reboot. Linger is called out in the document as the single
most common way an always-on runner turns out not to be one, on the strength of the
installer's own note rather than a reboot anybody performed.

**Gaps the document states rather than papers over:**

- **No health endpoint to point a monitor at.** `GET /api/health` does not exist, and
  `agents-studio status` is a command on that machine. Today the alarm is the morning
  message not arriving, which works and is slower than a monitor. The smallest honest
  fix is an unauthenticated endpoint that answers with the scheduler's last tick.
- **Backups off the machine are the reader's tooling.** Snapshots go to
  `~/.claude/agents-ui-backups`, outside the app's directory but on the same disk.
  Nothing here uploads anywhere and there is no setting for it; the document says
  which directory to point `restic` or `rclone` at and stops.
- **`CLAUDE_DIR` is pinned at install time only**, and nothing detects that the
  definition and your intent have diverged.
- **Nothing verifies credentials until they are needed.** See above — now observed.

Each of those is a brief rather than a paragraph of hope, which is what the brief
asked for.
