# r/ClaudeAI

**Title:** I got tired of not knowing which of my five Claude Code sessions actually worked, so I built a dashboard

**Body:**

Running several Claude Code sessions at once is easy — a worktree and a branch each.
Keeping track of them is not. I'd have five branches, five diffs, and no way to tell
which ones worked without checking out each one and running the tests myself.

So I built **Agents Studio**, a local web app that sits on top of the `.claude`
directory you already have.

What I actually use every day:

- **Sessions in parallel** — each on its own branch and worktree, so nothing lands in
  your working copy until you merge it. Start five at once from one paste, one
  instruction per line.
- **It tells you whether the work works.** After any turn that changes files, your
  project's own check command runs in that session's workspace. The list says *checks
  failed*, not *3 files changed*. A failing session won't merge until you say so — and
  if you override, that goes in the merge commit.
- **Rituals** — work on a schedule. A morning briefing, issue triage, a migration review
  before anyone opens the repo. When a scheduled run hits a permission prompt with
  nobody there, it stops immediately and offers the one narrow rule it needed, instead
  of hanging for ten minutes and denying anyway.
- **What everything cost**, plus limits that actually stop work — most per day, most per
  run. Both off until you set them.
- **A sentence saying what each session did**, written from its diff, so you can scan
  six sessions without reading six diffs.

It runs locally, reads your existing config, and uses your Claude Code login through the
Agent SDK — no separate API key.

    npm install -g agents-studio
    agents-studio

Then open localhost:3000 and point it at a repo.

MIT, no telemetry: https://github.com/davidrodriguezpozo/agents-ui

Genuinely after feedback on the scheduled side — I know what *I* run every morning, and
I'd like to know what other people would.

---

## Notes before posting

- **Attach `docs/screenshots/01-sessions-list.jpg` inline.** Reddit weights image posts
  well above link posts.
- Check the subreddit's current self-promotion rule and whether a Showcase-style flair
  is required.
- Space at least three hours from any other subreddit post to avoid the cross-post spam
  filter.
- Reply to every comment on day one. On Reddit that matters more than the post does.
