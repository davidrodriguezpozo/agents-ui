# 06 · An issue band on Land

**Wave** 2 · **Depends on** nothing · **Hot file** `app/pages/land.vue`
**Done when** Land has a third band listing issues assigned to you or carrying the agreed
label, each with one verdict, read through `gh` with the sign-in already there.

## Why

`server/utils/eventTriggers.ts` already fires a ritual on `issue_labelled`, so an issue can
already start work — and can never be *browsed*, judged, or picked up by hand. Every
competitor in the field starts from a ticket. This is the band that makes a colleague's
issue visible without them knowing the app exists.

## Build

- Read `app/pages/land.vue`, `server/api/github/pulls.get.ts`, `server/utils/github.ts` and
  `server/utils/wallPulls.ts` — copy the shape of the pull-request band rather than
  inventing a second one.
- `gh issue list` for: assigned to you, or labelled `studio` (a setting, with that default).
- One verdict per row, in the same spirit as the PR band: **Unassigned**, **Assigned to you**,
  **Has a session already** (a session whose branch names the issue number), **Waiting on a
  reply** (the last comment is not yours).
- Sorted by whether the next move is yours. The empty state names the label it is looking for.
- Cache and refresh the way the PR band does. No new polling loop.

## Acceptance

- `make check` green, with tests for the verdict function over fixture JSON — including an
  issue that is really a pull request, which `gh` returns and which must be dropped.
- By hand: label an issue in this repo `studio` and watch it appear.

## Out of scope

Starting a session from the row — brief 07. Writing anything to GitHub — brief 09.
