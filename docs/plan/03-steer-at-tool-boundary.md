# 03 · Steer a turn instead of stopping it

**Wave** 2 · **Depends on** nothing · **Hot files** `server/utils/sessionTurn.ts`, `app/pages/sessions/[id].vue`
**Done when** a message sent to a session mid-turn reaches the running turn at its next
tool boundary, and the page says it was delivered rather than queued.

## Why

`sendOrQueue` already keeps a message and sends it when the turn ends, which is the right
behaviour for "and then do this" and the wrong one for "no, not that file". Today the only
way to correct a turn heading in the wrong direction is to stop it and pay for the tokens
already spent. `server/utils/liveTrust.ts` proves mid-turn state can reach a running
query — this is the same trick carrying a message instead of a permission mode.

## Build

- Read `sessionTurn.ts` and `liveTrust.ts` closely, and check what the Agent SDK version
  in `package.json` actually supports for injecting input into a live query. **If it
  supports nothing, stop and write `## Blocked` with what you found** — do not fake it by
  killing and resuming the turn.
- Delivery at the next tool boundary, not mid-tool-call.
- The composer offers both when a turn is running: **Steer now** and **Queue for after**.
  Default stays queue; steering is the deliberate one.
- The transcript shows a steered message where it landed, distinguishable from an ordinary turn.

## Acceptance

- `make check` green, with tests for: no turn running (ordinary send), turn running and
  steered, turn running and queued, turn ending between the press and the delivery.
- By hand: start a long turn, steer it, watch the next tool call obey.

## Out of scope

Steering a ritual or a workflow run. Editing a message already delivered.

## Findings

**The pinned SDK can do it.** `@anthropic-ai/claude-agent-sdk@0.3.232` accepts
`prompt: string | AsyncIterable<SDKUserMessage>`, and the iterable form is
*streaming input* mode: stdin stays open and every message the iterable yields
reaches a CLI that is already mid-turn. Read out of the shipped `sdk.d.ts` and
`sdk.mjs`, since the worktree cannot read the parent checkout's `node_modules`
directly — a throwaway vitest file copied both out and was deleted.

The decisive detail is in the SDK's own message loop: on the first `result` it
calls `transport.endInput()` **only** `if (this.isSingleUserTurn)`, and
`isSingleUserTurn` is set from `typeof prompt === "string"`. Nothing else in the
SDK reads it, and it never reaches the CLI's argv — the transport is handed the
identical JSON line either way. So moving `executeRun` to an iterable prompt
changes exactly one thing: closing the input is now ours. `executeRun` does it on
the result and again in its `finally`, which is the same moment and the same
teardown the SDK would have used.

`Query.streamInput()` and `Query.interrupt()` exist too. Neither is used.
`interrupt()` would abort the very work being steered, which is the thing this
was built to avoid.

**Delivery at a tool boundary is the CLI's own behaviour, not ours.** The
`interrupt` control-request docs describe a mid-turn user message as a
`queued_command` *attachment* to the running turn that "never runs as its own
turn". So nothing here schedules the landing; it only avoids interrupting.
`SDKUserMessage.priority` (`'now' | 'next' | 'later'`) is left unset — it is
undocumented beyond the type, and `'now'` reads like the one that would land
mid-tool-call.

**Steer has no keyboard shortcut, deliberately.** `app/utils/keys.ts` is shared
by every message box in the app and treats ⌘↵ as a second send; taking it for
steering in this one composer would be the exact drift that file exists to
prevent. The brief asks for steering to be the deliberate one, and a button that
only a click reaches is that. The hint line says so rather than leaving it
looking unfinished.

**A message accepted but never delivered goes to the queue.** The turn can end in
the window between the button and the write. `closeSteerChannel` hands back
anything it never yielded and `executeRun` queues it on the session, so it
becomes what pressing the other button would have made it. `sendSteered` reports
which of steered, sent and queued happened, and the page says that rather than
what was asked for.

**Every run now uses streaming input, not only session turns.** Rituals,
summaries and repairs go through the same `executeRun`, so they all get a channel
nothing ever steers. Splitting the two paths would mean two ways to run a query
and two ways for closing stdin to go wrong; one path with an unused capability is
the cheaper of the two. The steer *endpoint* is session-only, which is where the
brief's out-of-scope line sits.

**The terminal app does not draw steers.** `cli/runStream.ts` folds run events
into its own `LiveRun` and simply ignores an event type it does not know, so the
TUI is unaffected and unimproved. Adding it is a `steers` field on that reducer
plus a row in the run pane — the brief named the browser composer, so it was left
alone.

**The by-hand acceptance was not done.** "Start a long turn, steer it, watch the
next tool call obey" needs a running server and a real agent turn, neither of
which an unattended session has. Everything below the SDK boundary is covered by
`test/liveSteer.test.ts`; what is untested is the CLI's own handling of a message
arriving mid-turn, which is the one part this code does not own.
