# 42 · Where the reply lands

**Wave** alone against `server/utils/reviewDraft.ts` · **Depends on** 39, 41
**Hot files** new `server/utils/decisionReply.ts`, `server/utils/liveSteer.ts`,
`server/utils/reviewDraft.ts`, `test/decisionReply.test.ts`
**Done when** a reviewer's reply is routed by the state of the session it is about, and the
cheapest route that is still open is the one taken.

## Why

**529 findings, none of them sent.** This machine holds 47 review drafts carrying 529
findings — 41 of them `BLOCKING`. `posted` is set on none. 45 are retired, and the reasons
are the whole argument for this unit:

| retirement | count | what it means |
| --- | --- | --- |
| `session_closed` | 20 | the opinion outlived the thing that could act on it |
| `pr_closed` | 14 | the work was already merged or abandoned |
| `head_moved` | 8 | the branch moved before anybody sent it |
| `already_reviewed` | 3 | somebody got there first |

Composing an opinion is solved here and has been for units. **Delivering one before it stops
being worth anything is not**, and 22 of those 45 were outrun by events rather than by a
person deciding not to send.

The same sentence has four different prices depending only on when it arrives:

```
while the turn is still running   liveSteer.ts     the code changes before it is written
turn done, session still open     sessionQueue     one turn
session ended, no PR yet          reviewDraft      a revision
PR already open                   a review comment a rewrite, an argument, and a day
```

This unit's entire job is to move a reply up that list.

## Build

**1. `decisionReply.ts`, which routes and does not decide.** Given a reply and the decision it
answers, pick the route from the session's *current* state — running, open, ended, PR open —
and say which one it took. The caller renders that; the page must be able to say *"sent into
the running turn"* rather than *"sent"*, for the reason `steer.post.ts` already gives about
its own three outcomes.

**2. Into a running turn, as quoted words.** Through the channel `liveSteer.ts` owns. The
sentence arrives attributed — the reviewer's name from `identity.ts`, the decision it is
about, and the reply as somebody's quoted opinion. Never as an instruction in the app's own
voice. A reviewer saying *"I'd worry about the queue"* must not become the app telling the
session to remove the queue.

**3. Into a draft, when the session is over.** A finding on the existing `ReviewDraft`,
anchored through `anchorFor` like every other one, and **never anchored by guessing**: a
decision's recorded files are not a diff position, and `reviewDraft.ts` already refuses to
invent one because a 422 loses the whole review. A reply that cannot be anchored becomes body
text, which is what `includeContext` is already for.

**4. The draft opens by decision, not by file.** When a pull request opens on work that has
decisions against it, the draft's spine is those decisions and their replies — answered,
disagreed, and *nobody answered* — with the mechanical findings underneath. This is the
payoff of all four units: the reviewer does not open a blank diff, and does not go looking for
where a choice was made, because every choice is already a heading.

**5. A reply to a decision on a session that no longer exists is dropped, and says so.** The
retirement table above is what happens when this is left implicit.

## Acceptance

Mechanised, with `CLAUDE_DIR` pointed at a temporary directory:

- Running session → the reply reaches the live channel, attributed, and the result names that
  route.
- Session open but idle → it queues as a turn.
- Session ended, no pull request → a draft finding exists; one whose files are outside the
  diff is body text, not a guessed anchor.
- Pull request open → the existing review path, unchanged.
- Session gone → dropped, with a reason a person can read.
- A draft composed for a session with decisions is ordered by decision, and unanswered
  decisions appear rather than being omitted.
- `make check` green.

## Out of scope

Posting anything to GitHub that `reviewPost.ts` does not already post. Changing what a review
session does. Any automatic action on a reply — a reply is read by a person or by a session
that a person started, never by a rule.

## Findings

- **The router is four booleans, and that is deliberate.** `routeFor` takes a `SessionShape`
  — exists, a turn is running, ended, a pull request number — rather than a `Session`, because
  a router handed a session invites the next reader to think it is looking at the branch, the
  worktree or the diff. It is not. The order is the price list read top down, and the two ends
  are the interesting ones: a running turn wins over everything including an open pull request,
  and a session that is gone loses to nothing.

- **The property worth defending is `quoteReply`.** A reviewer writing *"I'd worry about the
  queue"* means *consider this*; handed to a session bare, at the top of a turn, in the app's
  own voice, it reads as *remove the queue*, and the difference is a day of somebody's work. So
  every reply that reaches a prompt is attributed by name, fenced line by line in quotation,
  and followed by a sentence saying it is an opinion and that nothing obliges the session to
  change anything. It is the only path from `decisions.ts` into a model.

- **The spine had to be rebuilt, not appended to.** A first draft added one finding per reply,
  which met the routing acceptance and failed the one that matters: *"unanswered decisions
  appear rather than being omitted"*. A decision with no reply produced no finding at all, so
  the quiet choices went through unread — the exact failure these four units exist to fix. Now
  `decisionSpine` emits one finding **per decision**, holding its alternatives, its reason or
  *no reason given*, and every reply underneath. A second reply changes one heading rather than
  adding a second about the same choice.

- **Unanswered decisions are kept and unchecked.** Shown on the draft, not sent to GitHub:
  posting *"nobody said anything about this"* as a comment on somebody's pull request is noise.
  It is the `alreadyRaised` precedent — keep the finding, do not tick it.

- **A reply is `WARN`, never `BLOCKING`.** `BLOCKING` feeds `suggestedEvent`, which would turn
  a sentence somebody typed in Slack into this app requesting changes on their behalf. That is
  the app putting its weight behind an opinion it did not form. `OK` would bury it.

- **`composeDraft` now calls the spine too**, so a draft composed by a review session opens by
  decision without waiting for anybody to reply. A session that took no decisions gets exactly
  what it got before — asserted.

- **Replies route once, and the deduplication lives inside the store's lock.** A thread under a
  running turn is read every fifteen seconds, so routing everything the record holds would
  steer the same opinion into the same turn forty times. `addReplies` now returns what was new
  *this time* rather than the merged record.

- **Unproven, and it is the same gap unit 41 left.** The routing, the quoting, the anchoring
  and the ordering are all tested. **No reply has travelled the whole road** — Slack to
  `readDecisionThread` to `routeReply` to a real running turn. The `steered` and `queued` routes
  go through `steerRun` and `queueMessage` unchanged, which are exercised by `liveSteer.test.ts`
  against real sessions, so the seam is narrow; the seam is still unverified end to end.

- **The `comment` route deliberately does nothing new.** It puts the finding on the draft, the
  same as `draft` does, and differs only in what the page says and where `reviewPost.ts` will
  eventually send it. Posting anything to GitHub that `reviewPost.ts` does not already post was
  out of scope, and the routing is honest about being a label in that case.
