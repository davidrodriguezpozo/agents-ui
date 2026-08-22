# 09 · One comment back, and nothing else

**Wave** 5 · **Depends on** 07 · **Hot files** `app/pages/land.vue`, landing utils
**Done when** a session started from an issue posts exactly one comment on that issue when
it opens a pull request, naming the PR, and can post nothing else.

## Why

The person who filed the issue needs to know something happened, and they should not have
to be told by you in Slack. This is also the narrowest possible write: one comment, one
moment, composed here.

## Build

- Follow the Slack rule already in the app: **composed here, sent verbatim, denied every
  other way of writing**. The run that posts it holds one tool and no more.
- Trigger: the session's first pull request, once. Never on a later push, never twice.
- Text: what was done in one sentence (`server/utils/sessionSummary.ts` already writes it),
  the PR link, and that a person has not reviewed it yet.
- Off by default, with a setting, because a wrong comment on somebody else's issue is the
  kind of mistake that gets a tool banned.

## Acceptance

- `make check` green, with tests proving: one comment per session per issue, no comment when
  the setting is off, no comment when the PR already links the issue.
- By hand: on a throwaway issue in this repo.

## Out of scope

Replying to comments. Reacting. Closing. Any write to Notion.

## What was built

`server/utils/issueReply.ts` — the only writer. Three exported pieces: `mentionsIssue`
(whether the pull request already points at the issue), `issueToTell` (the whole decision, as
a pure function), `issueCommentBody` (the text), and `replyToIssue`, which composes those and
posts through `gh api repos/{owner}/{repo}/issues/<n>/comments` with the body on stdin. The
session record gained `issueReply` — what was said, where, and about which pull request — and
preferences gained `issueWriteback`, off by default.

`POST /api/sessions/[id]/pr` is the only caller, immediately after it records `prUrl`, and it
returns what happened beside the pull request's URL. `GET` on the same route now answers
`tellsIssue`, so the dialog says which issue will be told before the button is pressed and the
toast afterwards says it was. Settings gained **Commenting back on the issue**.

## Findings

- **No run, no tool, no agent — narrower than the Slack rule, not looser.** The brief said to
  follow the Slack delivery: composed here, sent verbatim, denied every other way of writing,
  and "the run that posts it holds one tool and no more". `digestSend` needs a run because
  Slack has no CLI. GitHub has one, and `reviewPost.ts` — the only other thing here that
  writes to somebody else's pull request — already uses it with the argument written down: *no
  agent reaches this*. So this posts with `gh` from the endpoint, and there is no tool an agent
  could call to get here at all. The consequence to know about is the other side of that trade:
  a session whose agent runs `gh pr create` itself never goes through this endpoint and so
  never comments. Nothing detects that, and nothing should — the trigger being one function
  call in one endpoint is what makes "never on a later push, never twice" checkable by reading.
- **The hot files in the header were 06's and 07's.** Nothing in `app/pages/land.vue` or the
  landing utils changed. Write-back happens where a pull request is opened, which is the
  session page and `server/api/sessions/[id]/pr.*`; the band that starts the work has no part
  in finishing it. The one place the two meet is `Session.issueOf`, which 07 already recorded.
- **`mentionsIssue` is deliberately blind to code fences, and GitHub is not.** `#42` inside a
  fenced block is not a link on GitHub and this counts it as one, so a pull request whose
  description quotes a shell comment containing `#42` loses its comment. That is the error
  worth making on purpose: the cost is a comment that was not posted, and the other way round
  is a comment nobody wanted. The trailing-digit guard is the part that is exact — `#420` and
  `.../issues/420` do not silence #42, and the URL case is why a plain `includes` would not do.
- **A failed post is not recorded.** `issueReply` means "this issue has been told", so writing
  it on a failure would silence the only retry there is, which is opening another pull request.
  The failure comes back as a value and gets its own toast; `replyToIssue` never throws,
  because the pull request is already open by then and reporting the whole call as failed would
  send somebody to undo one that is fine.
- **One comment per *session* per issue, which is not quite one per issue.** The record lives
  on the session, so two sessions on the same issue could each comment once. Pressing a row
  twice reuses the session (07's `sessionOnIssue`), so the ordinary path cannot reach it; a
  session cut by hand on the same issue can. Closing that would mean reading the issue's
  existing comments before posting — a GitHub read to guard a GitHub write, and a marker in the
  text to recognise our own — and it is not built. No marker is embedded in the comment.
- **Nothing shows on the session page after the fact except a toast.** The client `Session`
  type carries neither `issueOf` nor `ticketOf` — the band has never needed them there — so a
  persistent "told #42" line would mean surfacing the provenance too. The dialog says what will
  happen and the toast says it happened; the comment itself is on GitHub.
- **The suggested pull request body still does not mention the issue.** It could — `Closes
  #42` would close the issue on merge, which is more than a comment does — but that is a
  different decision about somebody's tracker, and it would turn this feature off by making
  `linked` true every time. Left alone deliberately.

## Acceptance not performed

**By hand: on a throwaway issue in this repo.** Not done. Posting to a real issue is a write to
GitHub and this session was unattended, so no comment was posted anywhere.

What is mechanised instead, in `test/issueReply.test.ts`: `node:child_process` is replaced by a
fake that records every invocation, so the three refusals are proved to make **no attempt**
rather than a failed one — a Notion ticket, the setting off, and a pull request that links the
issue itself all leave the recorder empty. The posting path asserts one call, to the issue's own
comments collection, with stdin byte-identical to what `issueCommentBody` composed; that a
second pull request from the same session is refused with `already`, having posted once; and
that a `gh` failure is reported without recording anything. `test/preferences.test.ts` pins the
default off.

**Unproven: that GitHub accepts this call and renders the comment as intended.** The endpoint
and the JSON shape have been exercised only against the fake. Somebody has to turn
**Commenting back on the issue** on in Settings, start a session from a throwaway labelled
issue, and press **Push and open** once — the dialog will name the issue it is about to tell.
