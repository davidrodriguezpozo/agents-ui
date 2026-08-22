# 30 · Reconcile the roadmap's premise

**Wave** 1 · **Depends on** nothing · **Hot file** `docs/roadmap.md`
**Done when** `docs/roadmap.md` no longer claims an audience the plan contradicts, and says
which decision changed and when.

## Why

`docs/roadmap.md` (sixth pass, 19 August 2026) states the audience is one person, "settled in
the fourth pass and not reopened". The plan in this directory assumes a tool a whole team
adopts. Both cannot be the operating premise, and the document's own convention is that where
an earlier pass was wrong it is *named* rather than quietly dropped.

## Build

- Update the audience section: one engineer is still the primary user; the team is now a real
  target, and the difference shows up as identity, shared configuration and a shared ledger.
- Keep the document's voice and its habit of dating decisions. Say what changed, when, and why
  — the competitive scan of 22 August 2026 and the decision to build the team plane.
- Link to `docs/plan/README.md` as where the sequence now lives, so the two documents stop
  competing to be the backlog.
- Do not restate the plan inside the roadmap. One copy of anything.

## Acceptance

- `make check` green.
- Read both documents in order. If a reader cannot tell which is the premise and which is the
  sequence, it is not done.

## Out of scope

Rewriting the rest of the roadmap. Deleting anything from it.

## Findings

- **Four places asserted the one-person premise, not one.** The audience section was the
  obvious one. The other three were reasons rather than claims: "Still not planned" justified
  refusing remote access with *"One person, one machine"*, telemetry was refused because
  *"there is one user"*, and the demoted storage debt rested on *"one person on one machine"*.
  All three refusals still hold under the team plane — for better reasons — so the decision
  was to keep every refusal and repair only the reasoning. Nothing was deleted.
- **The bets table was the second backlog.** *Configuration that travels through git* still
  said "promote it when you copy a ritual by hand", which is now the shared-configuration leg
  of a plan that schedules it. That row is marked promoted and dated; one line under the table
  says the plan owns *when* and the table owns *why*, rather than editing every row that the
  plan overtakes.
- **`docs/plan/README.md` points at the wrong roadmap.** Its second paragraph links "the
  roadmap" to a `claude.ai/code/artifact/…` URL. Going roadmap → plan now works; going plan →
  roadmap lands on an artifact nobody outside the session can open, so the pair only reads
  correctly in one direction. The fix is a one-word link change to `../roadmap.md`, but the
  contract forbids this session touching that file, so it is left for whoever merges wave 1.
- The competitive table was dated 19 August and the decision 22 August. The amendment says
  the scan *re-read* that table rather than producing it, so the two dates do not fight.
