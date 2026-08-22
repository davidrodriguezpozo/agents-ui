# 21 · A symbol map per worktree

**Wave** 2 · **Depends on** nothing · **Hot files** new `server/utils/symbols.ts` + tests
**Done when** for any session, one call returns the exported and imported names its diff
touches, cheaply, for TypeScript and Vue.

## Why

The foundation of collision radar, and the only part worth doing carefully. Git catches a
textual conflict and has nothing to say about one session renaming a function another one
calls. This brief builds the data; two later briefs act on it.

## Build

- Names *defined or changed* by the diff (exports, function and class names, Vue component
  names) and names *used* by it (imports, call sites). Per file, per session.
- Shallow and honest beats deep and slow: a regex-and-heuristics pass over the diff is
  acceptable if the comment says exactly what it will miss. Do not add a parser dependency.
- TypeScript and Vue only. Say so in the comment; a language it does not understand returns
  nothing rather than a guess.
- Cache per commit, since a session's diff only changes when the session does.
- Under 200ms for a fifty-file diff, or say why not.

## Acceptance

- `make check` green, with tests for: a rename, a new export, a deleted export, a re-export,
  a Vue component renamed, a file the pass does not understand.
- No UI in this brief.

## Out of scope

Cross-worktree comparison — brief 22. Any language beyond TS and Vue.

## Findings

- **`symbolMap(worktreePath, baseRef)` is the one call.** It returns
  `{ files, skipped }`; each file carries `defined`, `removed` and `used`, all
  sorted. `symbolsFromPatch(patch)` is the same pass with no git and no
  filesystem behind it, which is what most of the tests use. No new dependency,
  runtime or dev.
- **Uncommitted and untracked work counts.** The brief says "cache per commit",
  and per commit alone would have made the map blind at the one moment it is
  worth reading — an agent mid-turn has done the rename and not committed it.
  So the diff is taken from the merge base to the *working tree*, and untracked
  files are read off disk (`-uall`, capped at 200 files and 512KB each; anything
  past the caps is named in `skipped` rather than dropped quietly).
- **Which forced a second thought about the cache key.** It is the base ref, the
  head commit and the porcelain status. Porcelain has one blind spot — a second
  edit to an already-modified file produces an identical status line — so a
  dirty worktree only holds its answer for 3s, while a clean one holds it until
  the commit moves. Hashing the uncommitted diff instead (as `worktreeFingerprint`
  does) would cost a full `git diff HEAD` on every call, which is the thing the
  cache exists to avoid.
- **Under 200ms, measured.** Against this worktree's own diff: 144ms cold, 15ms
  warm. Three `git` invocations on a miss and one on a hit; at ~35ms of process
  startup each that is where the budget goes. The parse of a synthetic fifty-file,
  2,000-changed-line diff is single-digit milliseconds, and there is a test
  holding it under 200ms on its own.
- **What the pass misses is listed in the module comment, not implied.**
  Destructured exports, non-exported arrow consts, type positions, a
  `defineOptions({ name })` split over several lines, and a name in a block
  comment that opens mid-line. Uses are taken from added lines only — after this
  diff the session does not call the name it deleted.
- **JavaScript is skipped even though the same regexes would read it.** `.js`,
  `.jsx`, `.mjs` and `.cjs` go into `skipped` because the brief says TypeScript
  and Vue only. Adding them is one entry in `TS_EXTENSIONS` if brief 22 wants
  them.
- **No UI, as asked.** Nothing imports `symbols.ts` yet; brief 22 is its first
  caller.
