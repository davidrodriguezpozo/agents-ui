# Launch checklist

Ordered. Everything above the line should be done before a single post goes out.

## Blocking

- [x] **Global install works** — `npm install -g agents-studio`, verified by hand.
- [x] **First run against an empty config directory** — verified with a throwaway
      `CLAUDE_DIR`: the welcome leads with the pitch, and team setup offers the sessions
      route rather than dead-ending someone with no repository to paste.
- [x] **The rest of a genuinely cold machine.** Done in `node:22-slim` with no npm cache,
      no `~/.claude`, and no git, gh or Claude Code on the box.

      **The install is fine.** `npm install -g` takes 2–3 seconds, lands 60 MB, puts the
      binary on PATH, and the server answers in about a second. No compile, no native
      dependency, nothing to resolve — the no-compile install claim holds on a box with
      nothing on it. The page renders and every endpoint a cold start hits returns 200,
      including with git absent.

      **The suspicion in this item was right, and worse than it looks.** The setup wizard
      could not fire at all. It appears when `~/.claude` is missing, and the server writes
      its own storage into `~/.claude/agents-ui` while booting — so the directory always
      existed by the time anyone saw the page. The whole directory contained `agents-ui`
      and nothing else, and `exists` came back true.

      Behind it sat a second one: `/api/setup` refused when the parent existed, so even
      once the welcome appeared, pressing the button created nothing and returned
      "Directory already exists". Not an error, so the toast said it had worked — and the
      next read found nothing configured and showed the welcome again. A loop, on the
      first screen, for exactly the person this was written for.

      Both fixed and re-verified in the same container: `configured: false` on a cold box,
      the setup call creates `agents`, `commands`, `skills` and `workflows`, and
      `configured: true` afterwards so the welcome does not come back.
- [ ] **Decide the repo name.** The npm package is `agents-studio`, the app and README now
      say *Agents Studio*, the repo is still `agents-ui`. Rename the repo to match
      (GitHub redirects the old URL and the git remote keeps working), or leave it and
      accept that the launch posts link to a repo with a different name than the product.
      Either is fine; being asked about it in the comments is not.
- [ ] **Screenshots are current.** `docs/screenshots/*.jpg` are the good ones and match the
      product. `docs/images/*.png` are from the March version — `agent-editor.png`,
      `studio.png`, `explore.png`, `graph.png` — and `social-preview.png` sells the old
      pitch. Regenerate the social preview or delete the stale set so neither ends up in
      a post by accident.
- [ ] **Social preview uploaded.** Settings → General → Social preview, 1280×640. This is
      the image every Slack, Discord and X share renders. Manual, GitHub UI only.
- [ ] **Repo description and topics.** See `gh` commands at the bottom.
- [ ] **Hero GIF.** 20–40s, no audio, and it has to show the *unattended* pitch rather
      than the session one Desktop now also has: a ritual firing → the run it produced →
      a session whose checks passed → merge. Put it directly under the README title. The
      single highest-leverage asset, and the only item here I can't produce for you.
- [ ] **Rewrite the launch drafts.** They still sell parallel sessions, which Claude Code
      Desktop shipped in April 2026 — sidebar, worktrees, diff viewer, archive-on-merge.
      Leading with that now invites the obvious comment. The posts need to lead with what
      Desktop does not do: scheduling against a local repo, your own tests as a merge gate,
      a spend cap that skips work, and jobs that stop when they break.

## Same day, before posting

- [ ] `make check` green on a clean checkout
- [ ] Release the current main to npm, so the version people install matches what the
      README describes
- [ ] Enable **Discussions** on the repo (the issue-template config links to it)
- [ ] Create labels: `roadmap`, `good first issue`, `bug`, `enhancement`
- [ ] Open and pin the roadmap issue from [roadmap-issue.md](roadmap-issue.md)
- [ ] Tag 3–5 genuinely small issues `good first issue`

## Posting order

Tue–Thu. Don't do this on a Friday, and don't do it while travelling.

| When | Where | File |
| --- | --- | --- |
| 08:00 ET | Hacker News | [hackernews.md](hackernews.md) |
| 08:30 ET | r/ClaudeAI | [reddit-claudeai.md](reddit-claudeai.md) |
| 10:00 ET | X thread | [twitter-thread.md](twitter-thread.md) |
| 12:00 ET | Discord (showcase channels) | [discord.md](discord.md) |
| Next day | r/ClaudeCode, r/ChatGPTCoding, r/devtools | [reddit-other.md](reddit-other.md) |

Skip r/LocalLLaMA — reasoning in [reddit-localllama.md](reddit-localllama.md).

**Block the three hours after the HN post.** Not "check in occasionally" — sit there.
Nearly all of the outcome is decided by how fast the first ten comments get a real reply.

## The week after

- [ ] Every issue gets a response within a day, even if the response is "not soon"
- [ ] Write down what people actually asked for — that list is worth more than the
      current roadmap, which is guesswork by comparison
- [ ] If a thread went well, the architecture write-up (worktree isolation, the check
      queue, the permission broker) is the natural follow-up post

---

## Commands

```bash
# Repo description and topics
gh repo edit --description "Leave Claude Code running — work that fires on a schedule against your own repositories, checks itself with your own tests, and stops when it can't."
gh repo edit --add-topic claude,claude-code,ai-agents,developer-tools,git-worktree,nuxt,vue,agent-orchestration

# Labels
gh label create roadmap --description "Direction and priorities" --color 0e8a16
gh label create "good first issue" --description "Small, self-contained, well-scoped" --color 7057ff

# Roadmap issue (after writing the body out of roadmap-issue.md)
gh issue create --title "Roadmap — what's next, and what would help you most" --label roadmap --body-file /tmp/roadmap.md

# Rename the repo, if you decide to
gh repo rename agents-studio
```
