# Twitter/X thread

Five tweets. Media on 1, 2 and 3 — a thread of plain text does nothing.

---

**1 (hook) — attach `01-sessions-list.jpg`**

Running five Claude Code sessions at once is easy.

Knowing which five actually worked is not.

So I built a dashboard: every session on its own branch and worktree, with your own test
suite run against each one.

https://github.com/davidrodriguezpozo/agents-ui

---

**2 (the real feature) — attach `05-session-merge.jpg`**

The list doesn't say "3 files changed". It says checks passed, or checks failed.

A session that doesn't work sorts to the top and won't merge until you override it — and
the override is recorded in the merge commit.

---

**3 (rituals) — attach `07-ritual-needs-permission.jpg`**

The other half runs on a schedule. Issue triage at 07:00, a migration review before
anyone opens the repo.

When a scheduled run hits a permission prompt with nobody there, it stops and tells you
the one narrow rule it needed. Not blanket access.

---

**4 (spend)**

Leaving agents running on a schedule with no ceiling is how you find out what a bad loop
costs.

So: what every run cost, and hard limits — most per day, most per run — that skip the
work rather than report on it afterwards.

---

**5 (CTA)**

Local, MIT, no telemetry. Reads the .claude directory you already have and uses your
existing Claude Code login.

    npm install -g agents-studio

https://github.com/davidrodriguezpozo/agents-ui

---

## Notes before posting

- Pin the thread.
- Put the link in tweet 1 — X suppresses link-in-reply threads less than it used to, and
  most people never open the replies.
- Tagging @AnthropicAI is fine once, in tweet 5. Tagging in the hook reads as begging.
- One hashtag at most (`#ClaudeCode`). Two or more reads as spam.
