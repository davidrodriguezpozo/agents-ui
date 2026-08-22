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
