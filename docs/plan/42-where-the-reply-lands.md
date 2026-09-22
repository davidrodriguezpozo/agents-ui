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
