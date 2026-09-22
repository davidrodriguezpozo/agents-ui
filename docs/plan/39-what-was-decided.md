# 39 · What was decided

**Wave** alone against `server/utils/permissionBroker.ts` · **Depends on** nothing
**Hot files** new `server/utils/decisions.ts`, `server/utils/permissionBroker.ts`,
`server/api/permissions/[id].post.ts`, `server/utils/sessionTurn.ts`,
new `test/decisions.test.ts`
**Done when** every decision a session takes is recorded at the moment it is taken, with its
alternatives where they existed, and nothing leaves the machine.

## Why

**17 words in, 1205 lines out.** 71 of the 146 sessions on this machine still have a
transcript. Across them the human's own words total a median of 17 per session, 71 at p90,
222 at the maximum. 38 of those sessions still have a measurable branch: median 1205 lines
changed, 6973 at p90. Review today means reading the second number to recover the first —
decompiling an intent that was two sentences long out of a thousand lines of its
consequences.

**The one place the intent is already structured is thrown away on use.**
`server/utils/askUserQuestion.ts` parses `AskUserQuestion` — the question, every option with
its description, and the chosen one. `server/api/permissions/[id].post.ts` writes the answer
back into the tool input through `withAnswers` and resolves the pending request. Nothing
keeps the pair. That is a product decision *with its alternatives still attached*, which is
the one artifact a diff can never yield, and it survives exactly as long as the tool call.
It appears in 20 of the 71 transcripts.

**But most decisions here are not the human's, and the contract already says so.**
`CONTRACT.md` tells an unattended session: *"Nobody will answer a question. Decide, write down
what you decided, and finish."* The writing-down is already happening, in prose, in a
transcript nothing reads. This is the same shape `selfReported.ts` already found once — a run
that *told* you it had only reached three of six sources, in a line no reader existed for.

## Build

**1. `server/utils/decisions.ts`, the record.** One entry per decision: `id`, `sessionId`,
`at`, `source`, `what`, `alternatives[]`, `reason?`, `files[]`, `runId?`. A store per the
`defineJsonStore` neighbours, with the block comment the house style requires — say why it
exists and what was wrong without it.

**2. Four capture points, all of them free.** None of these adds a model call or a turn:

| source | the alternative it can record | where |
| --- | --- | --- |
| `ask_user_question` | every option, with its description | `permissionBroker.ts`, where `withAnswers` fires |
| `denied` | the refused call itself | the same broker, on a `deny` result |
| `steer` | what the turn was doing when it was interrupted | `sendSteered`, `sessionTurn.ts` |
| `marker` | none — prose only | `[DECISION] …` in assistant output |

**3. Parse, never model.** `reviewReport.ts` already argues this properly and the argument
holds unchanged: a line this cannot read yields **nothing**, not a half-populated record. The
failure that matters is not a thin feed — it is a decision attributed to somebody that they
did not take.

**4. `[DECISION]` is a contract line, not a prompt tweak.** Add it to `CONTRACT.md` beside the
sentence it extends: when an instruction or a fork constrains the design beyond the brief,
name it on its own line. One line, one decision, and the reason on the same line when there
is one.

**5. Nothing leaves this machine in this unit.** No Slack, no branch, no notification. The
whole gate is that the records exist and are right; 41 is what moves them.

## Acceptance

Mechanised, with `CLAUDE_DIR` pointed at a temporary directory:

- A session that answered an `AskUserQuestion` has one record carrying **both** options and
  which was chosen.
- A denied tool call produces a record whose alternative is the refused call.
- A steer produces a record; a steer sent when nothing was running does not claim an
  alternative it never had.
- A malformed `[DECISION]` line produces **no** record, and the count of skipped lines is
  readable — the `violations` precedent in `reviewDraft.ts`.
- Replaying the 71 transcripts on this machine produces a decision count per session that a
  person reading the transcript agrees with. Write the number you got under `## Findings
