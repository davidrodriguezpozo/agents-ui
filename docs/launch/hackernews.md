# Show HN

**Title (79 chars — HN caps at 80):**

`Show HN: Agents Studio – Run Claude Code sessions in parallel, and on a schedule`

**URL:** https://github.com/davidrodriguezpozo/agents-ui

**Text:**

I use Claude Code a lot, and two things kept going wrong.

The first is that running several sessions at once is easy — a worktree and a branch
each — but keeping track of them isn't. I'd end up with five branches, five diffs and no
idea which ones actually worked without checking out each one and running the tests by
hand. A diff tells you what changed. It doesn't tell you whether the result runs, and
that was the question I actually had.

The second is that the work I most wanted Claude to do was work I wanted done *before* I
sat down. Triage the issues, review the migration, write the briefing. Cron plus a
headless invocation gets you halfway, and then a permission prompt appears at 08:00 with
nobody there to answer it, and the run sits until it times out and denies anyway.

So I built a local web app that does both.

**Sessions** each get their own branch and worktree. After any turn that changes files,
your project's own check command runs in that workspace and the verdict lands on the
session — so the list says "checks failed" rather than "3 files changed", and a session
that doesn't work sorts to the top. A failing session won't merge until you override it,
and taking the override is recorded in the merge commit, so "was this known to be broken
when it landed" has an answer later. It's careful about failing-vs-not-running: a
workspace missing its dependencies exits non-zero and means nothing about your code, so
that's reported as having no verdict rather than as a failure, and it never blocks a
merge.

**Rituals** are the scheduled half. A run that hits a permission prompt stops
immediately and tells you the one narrow rule it needed — `Bash(gh issue edit:*)`, not
blanket access. Each ritual carries its recent outcomes, because the useful question
isn't what happened last time, it's whether the thing has quietly stopped working.

There's also a spend page and hard limits, most-per-day and most-per-run, because
leaving agents running on a schedule with no ceiling is how you find out what a bad loop
costs.

It reads the `.claude` directory you already have. Everything it writes is a real file or
a real branch — close it and nothing is trapped inside. It binds to loopback and there is
no auth, which is deliberate and documented: it runs commands as you, with your
credentials, against your repositories.

    npm install -g agents-studio
    agents-studio

Needs Node 18+ and Claude Code installed and signed in — it runs through the Agent SDK
and uses that login, so there's no separate key to set up.

Nuxt 3, Vue 3, VueFlow for the graph. MIT.

Happy to answer anything. I'm most interested in what people want from the scheduled
side — it's the part I have the least outside signal on.

---

## Notes before posting

- **Post the GitHub URL as the link** and put the text above in the text field. Show HN
  posts with both do better than text-only.
- **Tue–Thu, 8–9am ET.** Be at a keyboard for the next three hours; the first-hour
  response rate is most of what decides whether it moves.
- Don't say "AI-powered", don't say "revolutionise", don't thank people for upvotes.
- Prepare for *"why not just tmux + git worktrees + a shell script"*. The honest answer
  is that you can, and what this adds is the check verdicts, the spend ceiling and the
  permission handling — not the worktrees.
- And for *"isn't this just Claude Desktop"*: Desktop has parallel sessions. It has no
  scheduling against a local repo, no spend limits, and no test gate on merge.
- Read the [Show HN rules](https://news.ycombinator.com/showhn.html) once before
  submitting.
