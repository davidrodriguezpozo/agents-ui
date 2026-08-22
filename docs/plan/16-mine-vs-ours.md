# 16 · Mine and ours

**Wave** 7 · **Depends on** nothing · **Hot files** rituals, checks and sandbox stores
**Done when** a ritual, a check command and a sandbox rule can each be marked as belonging
to the repository rather than to this machine, and the repository half arrives by pulling.

## Why

Rituals, checks and sandbox rules are already files. What is missing is the distinction
between *mine* and *ours*: without it a shared ritual cannot arrive by pulling `main`, and a
personal experiment cannot avoid landing in somebody's review. This is the whole of the team
plane's configuration story, and it needs no server.

## Build

- Read `server/utils/schedules.ts`, `checks.ts`, `sandbox.ts` and `projectRules.ts`.
- Repository-scoped definitions live under the project's `.claude/` directory in a documented
  file. Machine-scoped ones stay where they are.
- Precedence is one rule, stated once and tested: repository provides the default, machine
  overrides it, and the UI always says which one is in force and where it came from.
- Editing a shared thing from the app writes to the repository file — a change a person
  reviews and commits, never something applied silently.
- A shared ritual that names a path only one machine has must fail legibly on the others.

## Acceptance

- `make check` green, with tests for precedence, for a shared definition that is invalid, and
  for a machine override being removed.
- By hand: commit a shared ritual, pull it in a second checkout, see it listed as shared.

## Out of scope

Syncing anything over a network. Per-person overrides of somebody else's ritual.
