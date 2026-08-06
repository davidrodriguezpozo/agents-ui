# Secondary subreddits

Short body for r/ClaudeCode, r/ChatGPTCoding, r/devtools. Post these **after** the
r/ClaudeAI thread has settled, at least three hours apart from each other.

**Title:** Open-source dashboard for running Claude Code sessions in parallel — with your own tests gating the merge

**Body:**

I could never tell which of my parallel Claude Code sessions actually worked without
checking out each branch and running the tests myself. So I built a local web app that
does it for me.

Each session gets its own branch and worktree. After any turn that changes files, the
project's own check command runs in that workspace, and the verdict goes on the session —
so the list says *checks failed* rather than *3 files changed*, and a failing session
won't merge until you override it.

There's a scheduled half too: rituals that run on a cron, stop cleanly when they hit a
permission prompt with nobody there to answer, and report what they cost. Plus per-day
and per-run spend limits.

Local, MIT, no telemetry. Uses your existing Claude Code login — no separate API key.

    npm install -g agents-studio

https://github.com/davidrodriguezpozo/agents-ui

---

## Notes before posting

- **r/selfhosted** wants a different lead — see the table in
  [reddit-localllama.md](reddit-localllama.md).
- Check each subreddit's self-promotion rule. Several require a ratio of participation to
  posts, and a brand-new account posting the same link to four subreddits is the exact
  shape their filters look for.
- Don't post the identical body to all of them on the same day.
