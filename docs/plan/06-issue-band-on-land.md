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

## Findings

- **A fifth verdict.** The brief named four. An issue that carries the label and is
  assigned to *somebody else* is none of them, and calling it "Unassigned" is a badge that
  is simply false — so there is `assigned-elsewhere`, drawn as "Assigned to marta". A false
  badge is worse than a fifth one.
- **"The last comment is not yours" needed a guard.** Read literally it makes every issue
  anybody has ever commented on into something waiting on you, including one filed by a
  stranger that is only on the page because of its label. So `awaiting-reply` also requires
  that the issue is yours in some way — assigned to you, filed by you, or one you have
  already spoken on. That is the difference between a band that says two things are waiting
  on you and one that says forty.
- **`gh api graphql` exits non-zero on a partial answer, having already printed it.**
  Confirmed against `cli/cli`: one alias GitHub cannot resolve — an issue transferred away,
  or a pull request number that slipped through — makes `gh` fail while stdout still holds
  every alias that *did* resolve. The obvious `catch { return empty }` therefore costs
  twenty-nine issues their conversation for one bad neighbour, so the error path re-reads
  stdout. `readThreadCounts` in `reviews.ts` has the same shape and the same hole; it is a
  one-line change there too and was left alone as out of scope.
- **The session join is the branch alone.** A pull request has a URL recorded on the session
  that opened it; an issue has nothing of the sort. `branchNamesIssue` compares the digit run
  as written rather than as a number, so `plan-06-issue-band` is not read as work on issue #6.
  Sessions are read on the server rather than joined in the page, unlike `workByPull`, because
  the verdict itself depends on the answer.
- **No new polling loop, as asked.** `useGithubIssues` has no timer. The Land page watches
  `readAt` on the pull request reading and refreshes the issues whenever it moves — mount,
  project switch, the header's refresh button, the two-minute poll that was already running.
  One timer, two bands, the same age.
- **`gh issue list` is called with `--assignee`/`--label`, not `--search`.** Pull requests are
  dropped anyway, three ways (`isPullRequest`, a `pull_request` object, and `/pull/` in the
  URL), because every GitHub API that reaches the issues table can return them and the shape
  depends on which one answered.
- **Not verified by hand end to end.** `readIssues` was run for real against
  `davidrodriguezpozo/agents-ui` and returns `ok` with the repository, the viewer and the
  label; pointed at the `roadmap` label it returns issue #2 with the verdict `unassigned`.
  Labelling an issue `studio` would be a write to GitHub, which an unattended session should
  not make — the label half of the query is proven by `roadmap` instead.
