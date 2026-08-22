# 00 · Set up for unattended sessions

**Wave** 0 · **Who** David, by hand, once · **Not a session.**

Autonomy is mostly configuration. Half an hour here decides whether twenty unattended
Claude Code sessions come back green or come back asking.

## Committed before anything starts

- [ ] **`docs/plan/` on `main`.** Each unit runs in a git worktree branched from `main`. A
      brief that is not committed does not exist inside the worktree that needs it.
- [ ] **A repo `CLAUDE.md`.** There is none today, which means every session starts by
      guessing the house style. It should be short and point at `docs/plan/CONTRACT.md`:
      the gate is `make check`; a fresh worktree needs `mkdir -p node_modules && bun run prepare`;
      never write to `~/.claude/agents-ui`; don't push, don't merge, don't bump the version.

## Permissions, so a session does not stop at 03:00

- [ ] **`.claude/settings.local.json`** allows what every unit needs and nothing else:
      `Bash(make check:*)`, `Bash(bun run:*)`, `Bash(bun install:*)`, `Bash(git:*)`,
      `Bash(gh:*)`, `Bash(mkdir:*)`. A prompt nobody is there to answer is a session lost.
- [ ] **Run with `--permission-mode acceptEdits`.** Bypass mode is not needed and buys
      nothing here except a wider blast radius.
- [ ] **A Stop hook running `make check`** is the cheapest way to make "green or not done"
      structural rather than a request. Worth trying on the first wave; drop it if it fights
      the pty caveat below.

## One worktree per unit

```bash
git worktree add .worktrees/plan-01 -b plan/01-diff-comments main
cd .worktrees/plan-01 && mkdir -p node_modules && bun run prepare
claude --permission-mode acceptEdits \
  "Implement docs/plan/01-diff-comments-to-turn.md end to end. Follow docs/plan/CONTRACT.md."
```

`.worktrees/` is already excluded via `.git/info/exclude`, so none of this shows up in a
commit by accident. Running the same thing through the app instead is fine — it cuts the
worktree and holds the transcript for you — but the plan does not depend on it.

## Cheap safety rails

- [ ] **A spending ceiling you have actually chosen**, since this is twenty sessions and not one.
- [ ] **Notifications on for blocked-on-permission**, the one failure autonomy cannot recover from.
- [ ] **`make check` green on `main` right now.** A red baseline makes every session's verdict
      meaningless, and they will each spend money discovering the same failure.
