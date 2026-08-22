# Working in this repository

Agents Studio — a Nuxt 3 app that leaves Claude Code running: scheduled work and parallel
sessions against your own repositories, gated on your own tests.

## The gate

`make check` — vitest, `nuxt typecheck`, and `tsc` over `cli/`. It passes on `main` and it
has to pass before you are done.

- In a fresh git worktree, first: `mkdir -p node_modules && bun run prepare`. Without it,
  checks fail in a way that looks like broken code and is not.
- `test/terminal.test.ts` cannot get a pty in a worktree. If that file alone fails on a pty,
  it is the environment — say so and move on.
- `nuxt typecheck` breaks a dev server that is already running: every route starts answering
  500 with `Unexpected token ')'`. Restart the server. Do not debug it.

## Never

- Write to `~/.claude/agents-ui`. It holds live sessions, rituals and the worktrees other
  work is happening in. A test that needs a store sets `CLAUDE_DIR` to a temp directory.
- Push, open a pull request, or merge. Commit on the branch you are on and stop.
- Bump the version in `package.json`. Releases are their own flow.
- Add a runtime dependency. There are deliberately none; a new devDependency needs a reason
  stated out loud.

## Style

- Vue 3 `<script setup>`, TypeScript, Nuxt UI components, shared state in `app/composables/`.
- Every `server/utils/*.ts` opens with a block comment saying why it exists and what was
  wrong without it. Read two neighbours before writing one.
- Tests in `test/`, mirroring the module path. Anything with a decision in it gets tests.
- Copy is plain and specific: a control says what will happen, and afterwards the page says
  it happened. No marketing voice.

## Planned work

`docs/plan/` holds the current implementation plan — one brief per unit, and
`docs/plan/CONTRACT.md`, which is the contract for unattended sessions. If you were handed
a brief, that file is the rest of your instructions.
