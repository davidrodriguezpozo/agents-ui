# 26 · Rules that learn, as a diff

**Wave** 9 · **Depends on** 25 · **Hot files** a panel + a write path
**Done when** a candidate lesson can be turned into one proposed line for `CLAUDE.md`, a
project rule, or the half of the brief you write — shown as a diff, applied only when accepted.

## Why

The compounding effect the cloud tools claim and cannot give a self-hosting team: because the
rule lands in the repository, one person accepting it improves everybody's agents on the next
pull. It only works if it is auditable, which means a file and a diff, never a hidden memory.

## Build

- One candidate, one proposed line, one destination — and the destination is a choice, shown
  before anything is written.
- The proposal is written by a small model from the *structured* candidate only. It never sees
  prose from outside this machine, and the brief's own rule about outside text holds.
- Accept writes the line and says which file changed. Reject records that it was rejected so
  the same lesson does not come back next week.
- **It can never write on its own.** No setting turns that on. The moment it does, this is the
  feature people disable.

## Acceptance

- `make check` green, with tests for: accept, reject, a candidate whose destination file does
  not exist, a rejected candidate recurring.
- By hand: accept one real lesson and read the resulting diff. If you would not have written
  that line yourself, the prompt is wrong.

## Out of scope

Editing existing rules. Removing rules that have gone stale — its own brief, later.
