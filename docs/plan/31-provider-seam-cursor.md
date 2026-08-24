# 31 · One session, any agent

**Wave** alone — it changes `server/utils/runner.ts`, which every other unit's work runs through
**Depends on** nothing
**Hot files** `server/utils/runner.ts`, `server/utils/runOptions.ts`, new `server/utils/providers/`
**Done when** a session created against Cursor runs its turns through `cursor-agent`, streams
into the same run log, resumes on its second turn and merges through the same train — and a
session against Claude Code is unchanged in every respect, including its records on disk.

## Why

This app is about 130,000 lines and almost none of it is Claude-shaped. Worktrees, the merge
train, GitHub, reviews, previews, the terminal, the scheduler and the ledger never learn which
model ran. The coupling is twelve imports of `@anthropic-ai/claude-agent-sdk`, six of which are
the `query()` call itself, and one function — `toQueryOptions` — that shapes every option.
Everything downstream already speaks `RunEvent`: `text`, `thinking`, `tool_use`, `tool_result`,
`result`, `permission_request`. The browser, `cli/runStream.ts`, the wall and the ledger consume
that, not SDK messages.

So the seam is small, and it is worth cutting for a reason better than neutrality: three
sessions racing the same brief on three different agents, in three worktrees, gated on the same
`make check`, with the train landing whichever one passed. None of the three CLIs can do that
for itself. This app already does the hard half.

Cursor first because `cursor-agent` is on the machine and its flags line up nearly one to one:
`-p --output-format stream-json --stream-partial-output`, `--resume <chatId>`, `--model`,
`--add-dir`, `--sandbox`, `--force`. Its `~/.cursor/cli-config.json` even stores permissions as
`Shell(git status)`, which is the shape `toSettingsPermissions` already produces.

## Build

**1. The interface.** `server/utils/providers/types.ts`. A provider starts a turn from a prompt
and a `ResolvedRunOptions`, emits `RunEvent`s, and returns the session id to resume with plus
whatever stats it knows. Do not invent a second event vocabulary; `RunEvent` in `runStore.ts` is
the vocabulary. Alongside it, a capability record — `canSteer`, `canPromptForPermission`,
`reportsCostUsd` — because the honest answer to "can this provider do that" is a value the UI
can read, not a comment.

**2. Move Claude behind it.** `server/utils/providers/claude.ts` takes the body of the loop in
`executeRun` as it stands. This is a move, not a rewrite: the permission broker, the steer
channel, the sandbox host detection, the budget and turn-limit handling and the `result`
bookkeeping all stay exactly as they are, and `test/` should not need editing to stay green. If
a test needs editing, the move was not a move.

**3. Cursor.** `server/utils/providers/cursor.ts`. Spawn `cursor-agent` in the session's
worktree with `-p --output-format stream-json --stream-partial-output`, `--resume <chatId>` on
every turn after the first, `--model` and `--add-dir` from the resolved options.

**Read the real output before mapping it.** One throwaway run in a scratch git repository, with
the stream captured to a fixture under `test/fixtures/`, and the mapping written against that
file. Guessing the event shape from the flag names is how this unit fails quietly. If the
account is not logged in — `cursor-agent status` — stop and write `## Blocked`; do not log in,
and do not mock a stream you have never seen.

**4. Finding the binary.** `server/utils/cli.ts` and `claudeExecutable.ts` answer "where is
Claude Code" twice for two reasons, and the comment in each says so. Add the same answer for
`cursor-agent` beside them rather than inside them, with a `CURSOR_AGENT_EXECUTABLE` escape
hatch mirroring `CLAUDE_CODE_EXECUTABLE`. `/api/system/health` should report which providers
this machine actually has.

**5. Which provider a record belongs to.** A `provider` field on `Session`, `Run` and the
schedule record. **Absent means Claude Code.** Every record already on disk is one, and a
migration that rewrites live session files to say something they already imply is risk bought
for nothing.

**6. Degradation, said out loud.** Three things do not port, and each one has to be visible
before the first turn rather than discovered after it:

- **Permissions.** `cursor-agent` headless has no `canUseTool`; it has a policy fixed at spawn.
  Translate the rules the app already resolves — `options.allowRules`, via the same
  `toSettingsPermissions` path — into Cursor's `permissions.allow` and pass them, and run
  without `--force`. An unattended run must not widen its own policy to get moving; it refuses,
  exactly as it does today.
- **Steering.** No stdin stays open, so `liveSteer` has nothing to write to. The steer endpoint
  answers "not available on this provider" and the composer offers Queue only. `sessionQueue`
  already is the fallback and needs no work.
- **Cost.** No `total_cost_usd`. Record the tokens and leave `costUsd` at zero rather than
  multiplying by a price nobody here can keep current. Check what the spend page and
  `outcomes.ts` do with a zero-cost run *before* assuming they tolerate it — a cost-per-merge
  that silently improves when you switch provider is worse than a blank.

The session card, the work rail and the run page say which agent ran a turn, and a session whose
provider cannot prompt for permission says that where it is created.

**7. Choosing it.** A provider picker where a session is created, and a per-project default in
settings. One place each, not four.

## Acceptance

- `make check` green.
- Tests, in `test/providers/`: the recorded Cursor stream mapped to run events, including a tool
  call, a tool result and a final result; the resume id passed on turn two and absent on turn
  one; a session record with no `provider` running as Claude; the steer endpoint refused on a
  provider that cannot steer; the allow-rule translation.
- By hand, and say in one line that it is what remains unproven: create a session on Cursor in a
  scratch repository, send two turns, read the diff, merge it.

## Out of scope

- **Codex.** It is the second adapter and it should be written against the seam this unit
  produces, not beside it. `codex` is not installed on the machine this was written on.
- **The library** — agents, skills, commands, plugins, MCP. Those are Claude Code's on-disk
  formats; Cursor has its own and they do not share a schema. Hide the section for a non-Claude
  session. Porting it is its own unit and probably its own wave.
- **Cursor's `--worktree`.** This app cuts its own, on its own branch naming.
- **Pricing tables**, and any dollar figure not reported by the provider.
- **Renaming `sdkSessionId`.** It is on disk in every session record. It means "the id this
  provider resumes with" now; a comment can say so for free.

## Findings

- **`cursor-agent` has no flag for permissions, and three ways to give it one.** Headless it has
  no `canUseTool` and reads its policy from `cli-config.json` at startup. Writing the user's
  `~/.cursor/cli-config.json` would change what their own terminal may do; writing
  `.cursor/cli.json` in the worktree (which Cursor does read, deep-merged over the global config
  — `--disable-project-configs` turns that off) would put a file in the repository that
  `git status` shows and the train could land. So each turn gets a `CURSOR_CONFIG_DIR` of its
  own holding nothing but the resolved rules. Verified on this machine: the login survives it,
  because credentials are in the keychain, and `CURSOR_DATA_DIR` is separate, so chats stay
  where they are and `--resume` still finds them.
- **Two event-shape rules no flag name would have given.** An `assistant` event is a text delta
  only when it has `timestamp_ms` and no `model_call_id` — Cursor re-sends each finished block
  whole, once stamped with its model call and once more at the end of the stream, so emitting
  every one tripled the answer. And a refused tool call is `result.rejected` with an *empty*
  reason, on a run that still ends `subtype: "success"` — so a turn allowed to do nothing reads
  as a clean pass unless the rejections are counted. They are, as permission denials. Both are
  asserted against `test/fixtures/cursor-stream-*.jsonl`, which are recorded runs.
- **A turn can end with no `result` at all.** Seen on the second capture: the model provider was
  briefly unreachable, and the run was two lines of stream, exit 1, and a sentence on stderr.
  Reported as a failure. Without the check it completed, with no output and nothing saying why.
- **The system prompt is a message here, not a channel.** There is no
  `--append-system-prompt`, so an agent's instructions and the standing brief go into the first
  thing the conversation reads. `cursorPrompt` therefore drops *all* of it on a resume, and
  deliberately does not delegate to `systemPromptFor(options, true)` — that keeps the agent's
  instructions, which is right where the system prompt is re-sent whole each turn, and would
  here append them to the conversation again as something the user apparently said, every turn.
- **A fourth thing does not port, beyond the three the brief names.** `cursor-agent` has no turn
  limit and no budget flag, so `maxTurns` and `maxBudgetUsd` cannot be enforced on a Cursor turn
  at all — unlike Claude Code, where `maxBudgetUsd` is handed to the SDK and stops the query
  itself. Nothing pretends otherwise; a Cursor session's spending is bounded only by the
  pre-flight `checkBudget`, which cannot help once a single turn goes wrong. Worth its own unit.
- **`--force` is passed for exactly one case**, and this is a judgement beyond the brief's line:
  `permissionMode === 'bypassPermissions'`, a session deliberately set to Auto. That is the same
  session the Claude path answers every prompt `allow` for, *before* it looks at whether anyone
  is watching — so refusing it here would make one choice mean two things depending on which
  agent ran. Every other run, unattended included, gets the allow list and nothing more.
- **The cost question had a real answer, and it was not "tolerated".**
  `costPerLandingUsd = landedCostUsd / landings.total`, so a Cursor merge added to the
  denominator and nothing to the numerator: the headline figure would fall every time one
  landed, improving because the records got worse. `OutcomeTurn` now carries `costReported`
  (**absent means yes**, so every record on disk is unaffected), landings that cannot be costed
  are counted in `landingsWithoutCost` and excluded from that division, and the ledger says how
  many it left out. **This also changed a pre-existing figure**: a session that landed in a
  window having done all its work before it was already contributing nothing to the numerator
  while sitting in the denominator, and now falls under the same rule. That understatement was
  in the same flattering direction, so the two are fixed by one rule rather than special-casing
  providers — but it is a change to a number that existed before this unit.
- **Tool names and argument keys both had to be translated, not passed through.**
  `outcomes.ts` decides whether a turn changed files by looking for `Write`/`Edit` in the log,
  and `describeToolCall` renders a step from `file_path`. Cursor says `editToolCall` and `path`.
  Left alone, a night of real Cursor work would have counted as a night of reading and every
  row in the work rail would have rendered blank.
- **Provider badges are on the rows that differ, not on every row.** A badge reading "Claude
  Code" on every row of a machine that has only ever used Claude Code is a column identical on
  every row, which this codebase's own rule about tables calls worse than no column. The run
  page is the exception and always says, because there the question is being asked directly.

## By hand

Driven for real, not through the UI: `server/utils/providers/cursor.ts` was called directly
against a scratch git repository on its own branch, twice.

- **Two turns, resumed.** Turn one created a file with a narrow allow list and no `--force`;
  turn two, given the chat id from turn one, resumed the same conversation and correctly acted on
  "that same file you just made". `stats` recorded 18,881 input and 299 output tokens,
  `costUsd: 0`, `numTurns: 2`. The diff was read and the branch merged into `main` with
  `--no-ff`.
- **Refusal.** A run granted nothing, unattended, asked for `whoami`: refused twice, the run
  flagged `needsAttention` with `deniedTools: ['Bash']` and both denials recorded — the same
  ending an unattended Claude run reaches, with no widening to get moving.

**Then proven above the provider too.** The path through the UI was the half a session cannot
press itself, and it was pressed by hand: a session created on Cursor from the picker on Start,
given a prompt, running its turns through `cursor-agent`. So the acceptance line is met end to
end.

**What is still unproven** is narrower than it was, and worth naming rather than letting the
tick above cover it: a Cursor session has not been put through the *merge train*, and no Cursor
run has been read on the spend page beside a Claude one. Neither is a guess about whether it
works — both are places the new `landingsWithoutCost` arithmetic shows up, and arithmetic is
worth looking at once with real numbers in it.
