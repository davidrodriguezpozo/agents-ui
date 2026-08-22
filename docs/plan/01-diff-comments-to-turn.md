# 01 · Comment on your own session diff

**Wave** 1 · **Depends on** nothing · **Hot file** `app/pages/sessions/[id].vue`
**Done when** selecting lines in Changes, writing a note and pressing once starts a turn
whose instruction contains those notes with their file and line numbers.

## Why

The review loop for a session's own work is a paragraph typed into a chat box that repeats
what the diff already says. `ReviewPane.vue` and `server/utils/reviewAnchors.ts` already
solve the hard half of this for GitHub reviews — anchoring a finding to a line that is
actually in the diff. Pointed inward there is no 422 to fear and no API to satisfy.

## Build

- Read `app/components/ReviewPane.vue`, `server/utils/reviewAnchors.ts`,
  `server/utils/reviewDraft.ts` and the Changes view in `app/pages/sessions/[id].vue`.
- Line selection in the diff, a note box per selection, and a list of pending notes with
  the count.
- One press composes the instruction and posts it to the existing
  `server/api/sessions/[id]/message.post.ts`. Format each note as
  `path:line` followed by the text, in file order, under one line of framing.
- A session mid-turn keeps the message — `sendOrQueue` already does this. Say which
  happened, the way the chat box does.
- Notes survive a page reload until they are sent (reuse the draft store pattern in
  `reviewDraft.ts`, keyed by session).

## Acceptance

- `make check` green.
- Tests for the composer: notes in file order, one note, twenty notes, a note on a line the
  diff no longer contains (dropped, and said so).
- By hand: two notes on two files, one press, the turn's instruction reads like something
  a person would have typed.

## Out of scope

Posting anything to GitHub. Threading, resolving, or a second round of notes on the same
lines — a note sent is a note gone.
