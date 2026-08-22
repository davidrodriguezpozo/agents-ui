# 18 · The shared ledger

**Wave** 7 · **Depends on** 11, 17 · **Hot files** new util + a push/pull path
**Done when** each instance appends its outcomes to a file it owns, those files can be
pushed to and read from a branch nobody reviews, and the ledger page can show team totals.

## Why

This is the only piece of the team plane that carries data between machines, so it is the
piece that decides whether the architecture stays local-first. Append-only, one file per
instance, git as the transport: no server, no accounts, and an instance that is offline for
a week is not a failure state.

## Build

- One file per machine, named by machine, append-only, one line per outcome — spend, landing,
  revert, check verdict, person, timestamp. Never rewrite a line.
- Push and pull are explicit and boring: commit to a dedicated branch, force nothing, and
  merge by concatenation because appends to distinct files never conflict.
- Reading team totals is reading every file present. A missing machine is a missing machine,
  and the page says how fresh each one is rather than averaging over a gap.
- **No prose in the ledger.** Ids, numbers, routes, timestamps. It must be safe to read into
  a page and it must never become an attack surface via a session title someone else wrote.

## Acceptance

- `make check` green, with tests for: append idempotence, two machines, a corrupt line
  (skipped and counted), a file from a newer version of the format.
- By hand: two checkouts on one machine, pointed at different `CLAUDE_DIR`s, produce one total.

## Out of scope

Real-time anything. Seeing another machine's in-flight sessions.
