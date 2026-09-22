# 41 · The doorbell

**Wave** alone against `server/utils/digestDelivery.ts` · **Depends on** 39
**Hot files** new `server/utils/decisionMessage.ts`, new `server/utils/decisionDelivery.ts`,
`server/utils/sharedLedger.ts`, `test/decisionMessage.test.ts`
**Done when** a decision reaches a reviewer who does not have this app open, and their reply
comes back to the machine that is waiting for it.

## Why

`notifyBus.ts` states the limit in its own words: *"a browser that is shut posts nothing."*
Unit 39's records are perfect and unread, on one laptop.

This app has solved this exact problem once already, and `digestMessage.ts` wrote down the
reasoning: *"A notification reaches you at the machine you were working on — and the same
sentence condemns the report it points at, which is a page on that machine. So it goes where
you already are."* A decision card is that, with a shorter fuse.

There is a second reason, and it is the one that decides the audience question: the best
reviewer of a *product* decision is often not an engineer. A PM or a designer will never have
this repository cloned, and a review system that can only reach people who do has quietly
decided that product decisions get reviewed by whoever happens to have a checkout.

## Build

**1. `decisionMessage.ts`, composing for somewhere that is not this app.** Inherit
`digestMessage.ts`'s two constraints verbatim, because both apply harder here: **it gets one
glance**, and **it cannot be clicked into** — every line carries its own reason. A card is the
decision, its alternatives, the reason or *no reason given*, the files, and nothing else.

**2. Two transports, doing two different jobs.** Say this out loud in the module comment,
because the split is the design:

- **Slack is the doorbell.** It carries the prose, reaches a phone in seconds, and is where a
  reply can be typed by somebody with no clone.
- **The git branch is the record.** Ids, numbers, routes and timestamps — `sharedLedger.ts`'s
  existing rule, unchanged, and the reason for it unchanged too: a colleague's prose must not
  reach your browser through a file your machine concatenates blindly. The branch says a
  decision exists and where; it does not carry what anybody wrote about it.

**3. The reply comes back by polling, from the machine that wants it.** Not a webhook.
`eventTriggers.ts` already settled this and the sentence is still true: *"this app is bound to
loopback and has no authentication in front of it — taking webhooks would mean opening a port
to the internet, which is a different product with a different threat model."* The developer's
machine is the one blocked on the answer, so it can poll hard — on the order of fifteen
seconds — and stop when the session ends.

**4. A reply is untrusted text from another person's machine.** It is rendered, never
executed, never interpolated into a prompt without being marked as somebody's quoted words.
Unit 42 is what does anything with it; this unit's job ends at delivering it intact.

**5. No Slack configured is a first-class state.** It says so once, on the surface where a
decision would otherwise have gone, and the records still exist locally. It does not retry,
warn repeatedly, or pretend to have delivered.

## Acceptance

- A composed card fits one glance and names its own reason on every line — checked against
  `digestMessage.test.ts`'s existing assertions, not by eye.
- A decision with no reason renders **no reason given**, not an empty field.
- The branch line carries no prose. Assert this with a record whose `what` contains a
  newline, a backtick and an `@here`; none of it may appear in the serialised line.
- A reply is read back and matched to its decision.
- With no Slack configured: nothing throws, records still written, the state is stated once.
- `make check` green.

## Out of scope

Routing the reply anywhere (42). Any second channel — e-mail, a webhook, a mobile app.
Delivering to a reviewer who has this app open and a decision surface in it; that is worth
its own unit once 42 says what a reply does.

## Blocked if

The Slack MCP server is not connected in the project this runs against. Say so and stop —
`CONTRACT.md`'s rule for unit 08.

## Findings

- **Not blocked.** The brief says to stop if the Slack MCP server is not connected here. It is:
  `~/.claude/agents-ui/digest-delivery.json` holds a resolved `channelId`, `userId` and
  `projectDir` from a send that worked by hand, so the transport is proven on this machine.

- **It reuses the digest's destination rather than asking for a second one.** One Slack set-up,
  two things that go through it. Somebody who has already proved a send works has answered
  every question this needed answered, and asking again would be the app forgetting what it was
  told. `deliveryRefusal` reads that same state and gives two distinct refusals — nowhere set
  up, and set up but the project has gone.

- **The branch needed a format decision, and it is the interesting one here.** A new `decision`
  event is a line older readers have never seen. Bumping `LEDGER_FORMAT` to 2 outright would
  have made a colleague who has not updated count **every one of this machine's turns** as
  unreadable — their spend total would quietly lose a person. So the version is now per line
  and describes what the line needs: `COUNTED_FORMAT = 1` for turn, landing, revert and check,
  whose bytes are unchanged, and `DECISION_FORMAT = 2` for the new one. An old reader meets a
  decision line, counts it under `newer`, skips it, and arrives at exactly the right totals —
  because nothing adds a decision up. That is the path `LEDGER_FORMAT`'s own note describes.

- **The no-prose rule is asserted with a hostile record**, not by eye: a decision whose `what`
  contains a newline, a backtick and an `@here`, whose reason contains `@channel` and whose
  alternatives contain `<!everyone>`. None of it appears in the serialised line, which carries
  a decision id, a session id, a source enum, a count of alternatives, an `answered` flag and a
  repo name.

- **A steer that overrode nothing is not sent.** `worthSending` refuses it: `steerDecision`
  records such a steer with no alternatives because nothing was running, which makes it an
  ordinary instruction wearing a decision's clothes. Sending those would train a reader to
  ignore the channel, which costs more than the one card it would have been right about.

- **The poll has its own timer, at fifteen seconds**, four times faster than anything else in
  `scheduler.ts`. It is affordable because `stillWatching` is a file read on every tick where
  nothing is outstanding — which, on a machine not using this, is every tick. It stops on two
  conditions: two hours since delivery (`WATCH_WINDOW_MS`), or the session is gone.

- **Unproven, and it needs a person.** Everything here is tested against the composer, the
  serialiser and the store. **Nothing has posted a real card to a real Slack.** `postToSlack`
  and `parseThreadReply` are reused rather than rewritten, so the transport is the one already
  working for the digest — but the card's own rendering in a real client, and a real reply
  coming back through `readDecisionThread`, are unverified. Turning the digest send on and
  taking one decision is what proves it.

- **Delivery fires at the end of a turn, not at the moment a decision is taken.** A decision
  taken mid-turn is often revised by the same turn, and a reviewer told about both has been
  told about one thing twice. `MAX_PER_PASS` is three: each card is a run, and a channel that
  receives six at once has been spammed rather than told.
