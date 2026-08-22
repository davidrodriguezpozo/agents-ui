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

## Findings

Decisions taken without anybody to ask, and what they cost.

- **Only the names that go away are intersected**, not the ones that change.
  `symbols.ts` gives three sets, and `defined` includes every name whose
  declaring line the diff merely touched — intersecting that with other
  sessions' `used` fires on any two sessions that share a helper, which is most
  of them. So the set is `removed`: names that exist before this merge and not
  after. A rename lands in it, which is the brief's own example. What is lost is
  the signature change — `resolveAgent(slug)` becoming `resolveAgent(slug, opts)`
  breaks every caller with the name still in place, and telling that apart needs
  a parser this repository deliberately does not have. Named in the block comment
  alongside the other three blind spots this pass adds to unit 21's.
- **Computed inside `previewMerge`**, beside `flakes`, rather than in
  `merge.get.ts`. It keeps `MergePreview` one shape in one file, and it means the
  dialog gets it for free. The cost is that `mergeSession` and the lander pay for
  it too and never show it: one `symbolMap` per live session in the repository,
  one to three `git` calls each, cached per worktree. Bounded by a short-circuit
  before any other worktree is touched — a merge that removes no names, which is
  most of them, spends one `symbolMap` and stops.
- **A dirty worktree's symbol map is held for 3 seconds** (`DIRTY_MS` in unit
  21), because porcelain cannot see a second edit to an already-modified file.
  The dialog reads the preview once when it opens, so a rename made in the three
  seconds before that read can be missing from the note. Closing and reopening
  the dialog is the fix, and it is not worth more than this line: the case is an
  agent mid-write at the exact moment somebody opens a merge dialog.
- `app/composables/useSessions.ts` keeps a hand-written mirror of
  `MergePreview`, so it gained `Collision` and the two fields. Same arrangement
  `Flake` already has.

### Acceptance, and the half of it left

The by-hand line — two sessions, one renames something the other calls, the
dialog says so — is mechanised in `test/collisions.test.ts` as far as this side
of the boundary goes: a real repository, three real worktrees, one renaming
`resolveAgent` while another calls it from a file the first never opens and a
third that calls it too has already landed. The test asserts the preview the
dialog renders carries the note, the name, and only the session still in flight
— and that `canMerge` stays true, since nothing here blocks anything.

What is unproven is the rendering: that the block below the checks panel in
`app/pages/sessions/[id].vue` appears and reads well. Somebody has to open the
dialog and look.
