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
