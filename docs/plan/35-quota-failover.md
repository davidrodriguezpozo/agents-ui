# 35 · Carry on when Claude runs out

**Wave** alone against `server/utils/budget.ts` · **Depends on** 31 (the provider seam)
**Hot files** `server/utils/budget.ts`, `server/utils/preferences.ts`,
`server/api/preferences.put.ts`, `app/pages/settings.vue`, `test/budget.test.ts`
**Done when** unattended work that is refused today for the Claude rate limit runs on the
other agent instead, and every place that work is read says which agent it ran on and why.

## Why

This is what the person using this app does by hand, every day: **Claude until the tokens run
out, then Cursor.** Not a comparison and not a preference — a substitution, at the moment one
agent stops being available.

Three things already exist and nothing joins them:

1. **The trigger.** The SDK emits `rate_limit_event` during runs that were happening anyway,
   and `quota.json` holds `status`, `resetsAt` and `rateLimitType`. Free, and already
   collected.
2. **The substitute.** `providers/index.ts`, and `cursorProvider` behind it.
3. **The moment.** `budget.ts:108–111` — `checkBudget(now, { unattended: true })` reads the
   quota, and returns `{ allowed: false, reason }`. Seven call sites go through it, and each
   one has the repository in hand.

The refusal is one decision away from a reroute.

## Build

**1. The preference becomes three-valued.** `pauseOnQuotaWarning: boolean` becomes an answer
with three cases — carry on, pause, or **continue on `<provider>`** — decoded so that a
preferences file written before this reads as exactly what it means today. The setting's copy
says the consequence out loud, because it is a real one: work you did not watch will run on
an agent you did not pick for it.

**2. `checkBudget` returns a substitution, not a refusal.** When the quota blocks *and* a
fallback is set, it answers `{ allowed: true, useProvider }`. Callers pass that to
`startSession`/`startTurn` instead of their own provider. A caller that ignores the field
gets today's behaviour, which is the safe direction for whichever of the seven is missed.

**3. Only the quota branch. Never the dollar caps.** A daily or per-run cap is a statement
about money, and the other agent also costs money — falling back there would turn a spending
limit into a redirection. The dollar caps keep refusing exactly as they do now, and a test
asserts it, because this is the mistake that would be discovered on an invoice.

**4. A fallback to an agent that is not installed refuses.** It does not fall through to
Claude and it does not fail silently: the refusal names the provider and says it is not on
this machine. `providerFor` deliberately treats an unknown id as Claude — that rule is right
for *reading old records* and wrong here, so this reads `PROVIDER_IDS` directly.

**5. It says so, three times.** `Run` records why the provider was chosen
(`providerReason: 'rate-limit-fallback'`), the ritual's row says the turn ran on the other
agent, and the morning report says it in the same voice as the skips band. **A substitution
nobody is told about is how you find out at lunchtime that eleven runs went to an agent you
did not choose.**

## Acceptance

Mechanised in `test/budget.test.ts`, which already has the store and the clock:

- Quota `rejected` + fallback set → `allowed`, with `useProvider` naming the substitute.
- Quota `rejected` + no fallback → refused, with today's reason, unchanged.
- Daily cap exceeded + fallback set → **refused**. The important one.
- Fallback naming an uninstalled provider → refused, naming it.
- An interactive call (`unattended` unset) is untouched in every case — the existing comment
  says why, and it still holds: a turn you typed is yours to spend.

## Out of scope

Switching a session that is already running — that is unit 36. Choosing the fallback per
repository rather than per machine; `projectProvider.ts` is where that would go if it is ever
wanted, and one answer is enough to prove the idea.
