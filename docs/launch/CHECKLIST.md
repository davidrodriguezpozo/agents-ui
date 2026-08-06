# Launch checklist

Ordered. Everything above the line should be done before a single post goes out.

## Blocking

- [x] **Global install works** — `npm install -g agents-studio`, verified by hand.
- [x] **First run against an empty config directory** — verified with a throwaway
      `CLAUDE_DIR`: the welcome leads with the workbench pitch, and team setup offers the
      sessions route rather than dead-ending someone with no repository to paste.
- [ ] **The rest of a genuinely cold machine.** Still unverified, because a machine that
      already has Node, git and a signed-in Claude Code can't test for their absence. In a
      container: no global npm cache, no `~/.claude`, and check that the setup wizard —
      which only fires when the directory does not exist at all — says something useful.
      Nothing kills a Show HN faster than the install failing in the first ten comments.
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
- [ ] **Hero GIF.** 20–40s, no audio: sessions list → open one → diff → merge preview with
      checks passing. Put it directly under the README title. It's the single highest-
      leverage asset and the only item here I can't produce for you.

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
gh repo edit --description "A workbench for Claude Code — run several sessions at once, each on its own branch, put recurring work on a schedule, and see what everything cost."
gh repo edit --add-topic claude,claude-code,ai-agents,developer-tools,git-worktree,nuxt,vue,agent-orchestration

# Labels
gh label create roadmap --description "Direction and priorities" --color 0e8a16
gh label create "good first issue" --description "Small, self-contained, well-scoped" --color 7057ff

# Roadmap issue (after writing the body out of roadmap-issue.md)
gh issue create --title "Roadmap — what's next, and what would help you most" --label roadmap --body-file /tmp/roadmap.md

# Rename the repo, if you decide to
gh repo rename agents-studio
```
