# 22 · The warning before the merge

**Wave** 5 · **Depends on** 21 · **Hot file** the merge dialog
**Done when** merging a session that changes a name other live sessions use says so, names
them, and lets you merge anyway.

## Why

The README already names this hole exactly. It is the difference between a merge train that
is polite about text and one that understands consequences — and it needs every checkout on
one machine, which is precisely what the cloud tools do not have.

## Build

- For the session being merged, the names it changes or removes; for every other live
  session, the names it uses. Intersect.
- The dialog says it beside the checks verdict, in the same voice: *renames `resolveAgent`,
  which two other sessions call — «title», «title»*. Never a modal of its own.
- Nothing is blocked. This informs; the checks gate.
- False positives are the failure mode that gets it ignored. Prefer silence to noise, and say
  in the comment what is deliberately not detected.

## Acceptance

- `make check` green, with tests for: no collision, one, a collision with a session that has
  since merged, a name changed in a file no other session imports.
- By hand: two sessions, one renames something the other calls, the dialog says so.

## Out of scope

Ordering the train — brief 23. Fixing anything.
