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

## Findings

**A second store, not a second mode.** `team-digest.json` beside
`digest-delivery.json`, because the two are different messages to different
places with different rules — and one record holding both would carry a
`commands` flag that means something for one destination and must never mean
anything for the other. Separate stores make that structural rather than
conditional. Everything the personal report learned is carried over verbatim and
not re-argued: off until switched on, no schedule until a send has worked by
hand, the destination resolved to an id once and used by id afterwards, a window
that covers everything since the last message, and a recorded skip that moves
that window on.

**The channel has no reply path at all — not a switch that is off.** The brief
asks that a channel "can receive and can never command", and the personal
report's `commandsRefusal` already refuses a channel in words. This is stronger:
there is no `commands` field on the record to set, and `teamCommandsRefusal`
returns a sentence unconditionally. It is a function rather than an absence
because "this cannot happen" is worth being able to *show* somebody in the place
they would look for the switch — the panel prints it there. A test asserts the
field does not exist.

**The message is composed here and sent verbatim**, through the same
`postToSlack` the morning report uses — same allow-list, same denials, so the
run that posts cannot make a canvas, a channel or a message that outlives it.
`threadTs` is deliberately never recorded for this destination: the team message
is never a thread anything replies into.

**The ledger gained one optional field: `repo`.** "What landed, by whom, **per
repository**" is in the brief and was not answerable, because unit 18
deliberately keeps paths out of the ledger — a path names a directory on
somebody's disk. The last segment of it does not: it is what everybody involved
already calls the repository. Added as optional and **without a format bump**,
which the format's own rule allows: a reader that has never heard of `repo` still
adds every line up correctly.

**Two of the brief's four content bands could not be honestly built, and are not
faked.** The shared ledger carries *outcomes* — turns, landings, reverts, check
verdicts — and nothing about attention or ritual health:

- *"What is blocked and on whom"* has no line to read. A blocked run is
  `needsAttention` on a run record, which is machine-local; publishing it would
  need a fifth event kind and a hook where `notify` already fires.
- *"Rituals that stopped working"* is the same shape of gap: `pausedReason` and
  the failing streak live on a machine's schedule store, not in the ledger.

Both were left out rather than assembled from *this* machine's state and labelled
as the team's, which is the one thing a message with a plural pronoun must not
do. Each is a small brief of its own: one event kind, one publisher, one band in
the renderer.

**A quiet day is quieter than the personal report's.** Landings, reverts and
failing checks are news; spend on its own is not. A day where three people each
burned four dollars and shipped nothing is what the ledger page is for, and a
channel told about it daily learns to skip the message. A machine that has gone
quiet is news but never *triggers* a message — otherwise it would fire every
morning for as long as somebody is on holiday — so it rides along with real news.

**Verified.** `make check` green, with the brief's four cases in
`test/teamDigest.test.ts`: a quiet day (both kinds of quiet), one machine
reporting, a machine silent for three days, and a reply from a channel refused.
Then by hand against a dev server on a chosen port with `CLAUDE_DIR` pointed at a
throwaway store holding three machine ledgers — one current, one current, one six
days stale. `GET /api/digest/team` previewed "3 merged, 1 taken back out, $4.75
across 2 turns, from 3 machines", the panel rendered it, the daily switch was
**disabled** with "waiting on a send that worked", and the refusal read as a
sentence at the bottom. That last bit found a real copy bug: an unset destination
is an empty string rather than null, so `??` let it through and the sentence
began with a space. Fixed and pinned by a test.

**Not sent for real, deliberately.** The brief's by-hand line — "send one to a
private channel first" — was not performed: it spawns a run that posts to a real
Slack workspace under the account this machine is signed in to, and doing that
unasked from a verification pass is not mine to do. Everything up to the post is
proven, including the composed message; what is unproven is the Slack MCP round
trip, which is the same path the morning report already uses in production.
