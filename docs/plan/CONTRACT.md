# The session contract

Every brief in this directory is written for a session nobody is watching. This file is
the half that does not change. A session prompt is one line:

> Implement `docs/plan/02-editor-deep-links.md` end to end. Follow `docs/plan/CONTRACT.md`.

## You are on your own

Nobody will answer a question. Decide, write down what you decided, and finish. A brief
that turns out to be wrong about the code is a finding to record, not a reason to stop.

## The gate

`make check` — vitest, `nuxt typecheck`, and `tsc` over `cli/`. It passes on `main` and it
has to pass when you are done. Three things about running it in a session worktree:

1. A worktree is a bare checkout. Before the first run: `mkdir -p node_modules && bun run prepare`.
   Without it the failure looks like broken code and is not.
2. `test/terminal.test.ts` cannot get a pty in a worktree. If that file alone fails on a
   pty, it is the environment. Say so in one line and do not chase it.
3. `nuxt typecheck` breaks a dev server that is already running — every route starts
   answering 500 with `Unexpected token ')'`. Restart the server. Do not debug it.

## What you must not touch

- **`~/.claude/agents-ui`** holds live sessions, rituals and the worktrees other work is
  happening in. Never write there. A test that needs a store sets `CLAUDE_DIR` to a
  temporary directory.
- **`package.json` version.** Releases are their own flow.
- **Other briefs, and `docs/plan/README.md`.** Two sessions editing the index is the one
  guaranteed conflict. Write findings inside your own brief only.
- **Files your brief did not ask you to change.** No drive-by reformatting.

## Where you stop

Commit on the session's own branch. Do not push, do not open a pull request, do not merge.
Green checks and a one-sentence account of what changed is the whole of "done".

## House style, briefly

- Every new `server/utils/*.ts` opens with a block comment saying **why it exists and what
  was wrong without it**. Read two neighbours first; the voice is consistent on purpose.
- Vue 3 `<script setup>`, TypeScript, Nuxt UI components, shared state in `app/composables/`.
- Tests live in `test/`, mirroring the module path. A new server util gets tests. UI-only
  changes do not need them; anything with a decision in it does.
- Copy is plain and specific. A control says what will happen; after it happens the page
  says it happened. An error says what went wrong and what to do about it. No marketing.
- **No new runtime dependencies.** `package.json` has none by design. A new devDependency
  needs a line of justification under `## Findings` in your brief.

## Acceptance you cannot perform

Some briefs end with a by-hand step: open the page, press the thing, watch an editor
launch. An unattended session cannot do those, and four waves have now proved it. So:

- **Mechanise it instead**, as far as the boundary you own — a test that drives the real
  function against a scratch fixture, an assertion that two surfaces reconcile. Then say in
  one line what remains unproven and who has to press it.
- **Never point a server at the real `~/.claude`.** If you start one at all, `CLAUDE_DIR` is a
  temporary directory and the port is one you chose and checked, never the default. A run
  that dies on a busy port having briefly pointed at live state is a near miss, not a pass.
- **Do not simulate the missing half.** A fake that makes the acceptance line green is worse
  than an honest gap, because the gap is the thing the next person needs to know about.

## Scope discipline

Do the brief. If it needs something the brief did not name, do the in-scope part, ship it
green, and append to your brief:

```
## Findings
- <what you found, and what it would take>
```

If you are genuinely blocked — a credential you do not have, an external service that is
not reachable — leave the workspace compiling (revert partial work that does not), and
append:

```
## Blocked
- <what is needed, and who can provide it>
```

Never invent a credential, never sign up for anything, never widen the sandbox.
