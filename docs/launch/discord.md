# Discord

For the Claude Code community server and any dev-tooling servers you're already active
in. **Post in the showcase / self-promo channel**, not general — most servers ban it
elsewhere, and getting removed on launch day is an avoidable own-goal.

---

Hey all — I built **Agents Studio**, a local web app for running Claude Code sessions in
parallel and on a schedule. MIT, no telemetry.

The problem it started from: running five sessions at once is easy (a worktree and a
branch each), but I could never tell which ones actually *worked* without checking out
each one and running the tests by hand.

So:

- **Sessions** — each on its own branch and worktree, and after any turn that changes
  files your project's own check command runs in that workspace. The list says *checks
  failed*, not *3 files changed*. Failing sessions won't merge until you override.
- **Rituals** — scheduled work. A run that hits a permission prompt with nobody there
  stops immediately and offers the one narrow rule it needed rather than hanging.
- **Spend** — what each run cost, plus per-day and per-run limits that stop work rather
  than report on it.

It reads the `.claude` directory you already have and uses your existing Claude Code
login through the Agent SDK — no separate key.

```
npm install -g agents-studio
agents-studio
```

https://github.com/davidrodriguezpozo/agents-ui

Would love feedback, especially on the scheduled side — that's where I have the least
outside signal.

---

## Notes before posting

- Attach `docs/screenshots/01-sessions-list.jpg`.
- Be a participant in a server before you post to it. Drive-by launches get deleted.
