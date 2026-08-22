# 19 · The team digest

**Wave** 8 · **Depends on** 18 · **Hot files** digest utils, Slack delivery
**Done when** one message a day to a channel says what the team shipped, what is blocked, and
what it cost — and says nothing at all on a quiet day.

## Why

The personal morning report already works and is the model to copy, including its four
carefulnesses. A team channel needs the same discipline harder: a daily "all quiet" is how a
channel gets muted, and a muted channel loses the feature.

## Build

- Read `server/utils/digest.ts`, `digestMessage.ts`, `digestDelivery.ts`, `digestSend.ts`
  and follow every rule already there: nothing on a quiet day, the schedule does not start
  until a manual send has worked, the destination is resolved to an id once, and it covers
  everything since the last message rather than a fixed day.
- Content: what landed, by whom, per repository; what is blocked and on whom; the day's cost;
  rituals that stopped working. Read from the shared ledger, not from one machine.
- **A channel can receive and can never command.** The reply-becomes-a-session path stays
  DM-only, and the code must refuse a channel explicitly, in words, as it does today.
- Composed here, sent verbatim, and the run that posts it is denied every other way of
  writing to Slack.

## Acceptance

- `make check` green, with tests for: a quiet day, one machine reporting, a machine that has
  not reported in three days, a reply attempted from a channel (refused).
- By hand: send one to a private channel first.

## Out of scope

Threads, reactions, mentions, or asking the channel anything.
