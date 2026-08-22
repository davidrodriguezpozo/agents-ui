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

## Findings

- **Half of this already existed.** `app/pages/sessions/[id].vue` already had line
  selection, an in-place note box, a pending list with a count, and `formatReview` in
  `app/utils/patch.ts`. What was missing was the four things the brief actually turns on:
  the `path:line` format, surviving a reload, not being refused mid-turn, and doing
  something honest with a note whose line has gone. So this is mostly a rewrite of
  `formatReview` into `composeNotes` plus a durable store, not a new pane.
- **The store is server-side, not `localStorage`.** "Reuse the draft store pattern in
  `reviewDraft.ts`" reads as `defineJsonStore`, so notes live in
  `~/.claude/agents-ui/diff-notes.json` keyed by session, behind
  `server/api/sessions/[id]/notes.{get,post,delete}.ts` — the same shape as the message
  queue endpoints. The server assigns each note's id, because the id is what removing one
  is addressed to and two tabs minting their own could collide.
- **Staleness is checked on (file, line), not on the snippet.** A note carries the line it
  was written against, but matching on that text would drop a note whose line merely moved,
  which is the common case and not the one the brief is about. So a note is dropped only
  when `file:line` is not a commentable line of the diff on screen. The snippet is now only
  used by the pending list.
- **An empty patch drops nothing.** Notes are restored before the diff arrives, so an
  empty `patchLines` means "we cannot tell", not "the diff contains none of these". Sending
  in that window would otherwise discard every note. Tested.
- **Dropped notes are cleared, not kept.** They are named in the toast and then gone. The
  alternative — leaving them in the list — means the next press sends `path:line` for
  whatever has since moved to that number, which is the mis-anchoring `reviewAnchors.ts`
  exists to refuse.
- **The snippet no longer goes in the instruction.** The brief specifies `path:line`
  followed by the text, and the composer now checks the line is really in the diff before
  sending, so the fenced copy of the line that `formatReview` carried as insurance is no
  longer buying anything.
