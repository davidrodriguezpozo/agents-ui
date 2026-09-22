# 40 · The reason, while you still have it

**Wave** alone against the Now queue · **Depends on** 39
**Hot files** `app/utils/nowQueue.ts`, `app/components/NowQueue.vue`,
`server/utils/decisions.ts`, `test/nowQueue.test.ts`
**Done when** a decision recorded without a reason raises one deferrable, one-line question,
and answering it fills the record.

## Why

An imperative carries no reason. *"Build it with a queue"* records cleanly through unit 39 —
the what, the files, the moment — and the one thing a reviewer actually wants is the one
thing it does not have. By the time the pull request opens, the person who decided it has
forgotten too, which is why the answer given at review time is a reconstruction rather than a
reason.

The cheapest moment to ask is the moment it was still true. It costs the developer one line
and five seconds, and it is worth more to the reviewer than the whole diff, because it is the
only part of the decision that was never written down anywhere.

The trap is obvious and has to be designed against: this app's entire posture is that you can
leave it running. A modal that stops you to ask why is the opposite of that, and it would be
switched off within a week.

## Build

**1. A row in the Now queue, never a modal, never a blocking prompt.** The queue already
answers "what needs me" and already mixes sessions, rituals and pull requests. An unanswered
*why* is exactly that shape: small, yours, and safe to ignore until you want it.

**2. One line in, stored on the record.** No form, no severity, no category. The field is
`reason` on the entry unit 39 already wrote; answering is an edit to one record and nothing
else.

**3. Unanswered is a shipping state, not a blocked one.** The decision goes to the reviewer
either way, marked **no reason given**. This is the decision worth defending: a reviewer
seeing an unexplained choice has learned something real — either it was obvious, or nobody
could say why, and both are worth knowing. Holding the decision back until the developer
answers would turn a review feed into a queue of the developer's own unfinished homework.

**4. They expire.** A *why* nobody answered within some days of the decision retires itself
the way `reviewDraft.ts` retires a stale draft, with a reason, rather than sitting in the
queue forever accusing somebody. Pick the window, state it in the brief, and say it in the
copy.

**5. Batched, not per decision.** A session that took six decisions raises one row asking
about six, not six rows. The queue is the surface this app has already twice nearly ruined by
putting one row per event on it.

## Acceptance

- A decision recorded with a `reason` already set raises nothing.
- A decision without one raises exactly one queue row; six such decisions in a session raise
  one row, not six.
- Answering writes the reason to the record and clears the row; the decision is still
  deliverable either way.
- The row expires on its own, and says why it went.
- Nothing about this blocks a turn, a session or a merge. Assert it.
- `make check` green.

## Out of scope

Asking the *agent* to justify itself — a model explaining its own choice after the fact is a
plausible sentence, not a reason, and it is the one thing here that would poison the record.
Any notification for an unanswered *why*.

## Findings
