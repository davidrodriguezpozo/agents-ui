# 36 · Continue this session on the other agent

**Wave** alone — it changes `Session.provider` after the fact · **Depends on** 31, and reads
better after 35
**Hot files** new `server/api/sessions/[id]/provider.post.ts`, `app/pages/sessions/[id].vue`,
`server/utils/sessionSummary.ts`, `test/handover.test.ts`
**Done when** a session that has run out of Claude carries on with the other agent, on the
same branch and the same worktree, with the next turn told what has happened so far.

## Why

Unit 35 keeps *unattended* work moving. This is the interactive half, and it is the move
actually made by hand today: Claude stops mid-afternoon, and the work continues in Cursor on
the same branch. In this app that currently means a new session, a new worktree and a
conversation left behind.

The conversation genuinely cannot transfer. `sdkSessionId` is Claude's; Cursor keeps its own
chats under `CURSOR_DATA_DIR` and resumes them with its own id. **The work transfers whole
anyway** — same checkout, same branch, same uncommitted diff — and the conversation transfers
as a hand-off rather than as state. `sessionSummary.ts` already writes that summary, from the
session's diff and its last answer, for the sessions list.

And the seam is already per-turn: `sessionTurn.ts:431` reads `session.provider` on every
turn, not once at creation. A session that changes agent halfway through is closer to free
than it looks.

## Build

**1. `POST /api/sessions/:id/provider`.** Sets `session.provider`, refuses while a turn is in
flight, and refuses a provider that is not installed. Records the change on the session with
the time and both agent names, because "why does this session's second half look different"
is a question somebody will ask a week later.

**2. The hand-off is composed, not assumed.** The next turn is seeded with: the branch, the
files changed so far, the last thing the previous agent said, and the instruction that
started it. Composed by the same summary path that already exists rather than by a new
prompt, and included in the turn's input so it is in the record — a hand-off that only lives
in a system prompt is one nobody can read afterwards.

**3. The button says the two costs.** *The new agent has read a summary, not the
conversation* — and *steering stops working*, because `capabilitiesOf('cursor').canSteer` is
false and `sessionTurn.ts:108` already refuses on it. Both are true, both are surprising, and
both are cheaper to say than to discover.

## Acceptance

Mechanised, with `CLAUDE_DIR` in a temporary directory and no real agent spawned:

- The provider on the record changes, and the next turn is dispatched to the new provider.
- The hand-off text contains the branch, the changed files and the previous answer.
- A turn in flight refuses, and the record is untouched.
- An uninstalled provider refuses, naming it.
- The worktree, the branch and the session id are unchanged across the swap — asserted, not
  assumed, because the whole value of this is that the work does not move.

## Out of scope

Carrying the conversation itself. Handing back afterwards is the same endpoint and needs no
special case.
