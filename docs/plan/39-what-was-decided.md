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
  person reading the transcript agrees with. Write the number you got under `## Findings`.
- `make check` green.

## Out of scope

The rationale prompt (40), delivery to anybody (41), routing a reply (42). No UI beyond
whatever the tests need — a list nobody has designed yet is a list that will be rebuilt.

## Findings

- **The brief's hot files were one file short, and one file wrong.** The capture for
  `ask_user_question` and `denied` could not go in `server/api/permissions/[id].post.ts`: that
  endpoint holds a request id and an answer and nothing else — no session, no run — and a
  decision with no session to hang off is one nobody can review. It went into
  `server/utils/providers/claude.ts`'s `onSettled`, which is the first place the answer and
  `run.sessionId` are in scope together. The endpoint is untouched.

- **`permissionBroker.ts` had to learn who settled a prompt.** It settles for four reasons —
  an answer, a ten-minute timeout, an aborted run, a disposed turn — and all four arrived at
  `onSettled` looking identical. Filing the last three would have put refusals on the record
  that no person made, which is the exact failure this unit says matters most. `SettledBy` is
  the new third argument; every existing caller ignores it. The provider also tracks the
  prompts *it* answered itself (auto-trust, and the unattended refusal), because those reach
  `answerPermission` and are indistinguishable from a button press without it.

- **Replay, read-only, over this machine's own store.** 621 run files, 583 with a session id
  and output; 328 transcripts under `~/.claude/projects`.

  | source | what a replay yields | confidence |
  | --- | --- | --- |
  | `ask_user_question` | **78 calls in 58 transcripts, 72 carrying an answer** | high — spot-checked by putting two real calls through `questionDecisions`, options, descriptions and the chosen one all intact |
  | `denied` | **44 denials across 23 sessions** | upper bound only — see below |
  | `marker` | **0** | the convention did not exist until this commit |
  | `steer` | not replayable | a steer's alternative is the step in flight, which is only in memory |

  So: **23 sessions on this machine would carry at least one decision from the permission
  sources alone**, and the question source is worth roughly **72 decisions with their
  alternatives still attached** — the artifact the brief says a diff can never yield.

- **The denial count is an upper bound, and will stay one.** A persisted
  `permission_resolved` event records `behavior` and nothing else, so a replay cannot tell a
  person's refusal from a prompt that timed out. Live capture can, because `SettledBy` is
  checked at the moment it settles. Persisting `by` on the event would make the record
  auditable after the fact; it is one field and it was left out as out of scope.

- **0 markers is the honest number and not a passing one.** The `[DECISION]` line is new in
  `CONTRACT.md` as of this commit, so nothing in history contains one. The parser is covered
  mechanically — reason splitting, backticked paths, fenced code stepped over, a marker
  mid-sentence ignored, a malformed line counted as a violation and filed as nothing — but
  **it has never read a line a model actually wrote**. The first unattended session run under
  the new contract is what proves it; whoever runs one should check the count against the
  transcript by eye.

- **Decisions already outlive their sessions.** The run files reference 239 distinct session
  ids; `sessions.json` holds 144. Almost 100 sessions' worth of decisions would have nothing
  left to hang off. Unit 42 names this case — *"a reply to a decision on a session that no
  longer exists is dropped, and says so"* — and the ratio says it is the common case, not the
  edge one.

- **A real bug the tests caught.** `[DECISION] — because` was read as a decision called
  "— because". A line that opens with the separator gave a reason and no decision; it is now a
  violation, which is what "a line this cannot read yields nothing" has to mean.
