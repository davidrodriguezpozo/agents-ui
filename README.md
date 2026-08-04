<div align="center">

# Agent Manager

**A workbench for Claude Code.**

Run several sessions at once, put recurring work on a schedule,
and see everything Claude has done for you — without leaving the browser.

<a href="#quick-start">Quick start</a> ·
<a href="#sessions">Sessions</a> ·
<a href="#daily-rituals">Rituals</a> ·
<a href="#activity">Activity</a> ·
<a href="#configuration">Configuration</a> ·
<a href="CONTRIBUTING.md">Contributing</a>

<img src="https://img.shields.io/badge/license-MIT-5b5bd6?style=flat-square" alt="MIT licence" />
<img src="https://img.shields.io/badge/Nuxt-3-5b5bd6?style=flat-square" alt="Nuxt 3" />
<img src="https://img.shields.io/badge/runs-locally-5b5bd6?style=flat-square" alt="Runs locally" />

<br />

![Sessions running in parallel, each on its own branch](docs/screenshots/01-sessions-list.jpg)

</div>

---

Agent Manager reads the `.claude` directory you already have and the repository you
point it at. Everything it shows you is a real file or a real branch; everything it
writes is something you could have written by hand. Close the app and nothing is
trapped inside it.

| Section | What it's for |
| --- | --- |
| **Sessions** | Several pieces of work at once, each on its own branch and its own checkout |
| **Daily** | Rituals — work that runs on a schedule, so the result is waiting when you get in |
| **Activity** | Every run there has ever been, with cost, duration and outcome |
| **Agents** | Subagents, their model tier and what tools each is allowed |
| **Workflows** | Agents chained into a pipeline, run step by step |
| **Commands** | Slash commands, grouped by whether you wrote them or a plugin brought them |
| **Skills · Plugins** | What is installed, where it came from, and what it adds |
| **Explore · Graph** | Find new things to install; see how what you have connects |

---

## Quick start

```bash
git clone https://github.com/davidrodriguezpozo/agents-ui.git
cd agents-ui
bun install
bun run dev
```

Open **http://localhost:3000**. Pick the project you want to work on from the bottom
of the sidebar — that's the repository sessions will branch from.

> **You'll need:** [Bun](https://bun.sh) (or Node.js 18+ — swap `bun` for `npm`), and
> Claude Code installed and signed in on this machine. Sessions, rituals and workflows
> run through the Claude Agent SDK and use that login; there is no separate key to set up.

---

## Sessions

Each session gets its own branch and its own checkout of your repository, so several
can run at the same time without overwriting each other. Nothing lands in your working
copy until you merge it.

The list is about *what each session has produced* — files changed, commits, work still
uncommitted, turns taken — rather than about the fact that something is running.

A turn heading in the wrong direction can be stopped from the session itself. Stopping ends
the turn, not the work: whatever it already wrote is still in the workspace, and still in
the diff.

![Every worktree git actually knows about](docs/screenshots/02-worktrees-on-disk.jpg)

Checkouts live in `.worktrees/` inside your repo and are hidden from `git status` via
`.git/info/exclude`, so they never show up in a commit by accident. **Workspaces on disk**
lists every one git actually knows about, so none of them quietly accumulate.

### Read it, then decide

<table>
<tr>
<td width="50%"><img src="docs/screenshots/04-session-diff.jpg" alt="Per-file diff of what the session changed" /></td>
<td width="50%"><img src="docs/screenshots/05-session-merge.jpg" alt="Merge preview naming the commits and the target branch" /></td>
</tr>
<tr>
<td><b>What changed</b>, per file, next to the conversation that produced it.</td>
<td><b>Merge</b> tells you what is about to be brought across and into which branch, before it touches your checkout.</td>
</tr>
</table>

The conversation itself is rendered properly — headings, lists, tables and code, the way
the agent wrote them.

![A session's conversation](docs/screenshots/03-session-conversation.jpg)

---

## Daily rituals

Work that runs on a schedule: a morning briefing, issue triage, a migration review
before anyone opens the repo. Each ritual is a command, a recurrence and a next run —
and it tells you which ones came from a plugin rather than being written by hand.

![Scheduled rituals with recurrence and next run](docs/screenshots/06-daily-rituals.jpg)

### When nobody is there to answer

A scheduled run that hits a permission prompt does not sit and wait for ten minutes and
then deny anyway. It stops immediately, tells you exactly what it was blocked on, and
offers the one narrow rule it needed — `Bash(gh issue edit:*)`, not full access.

![A ritual that stopped on a permission prompt](docs/screenshots/07-ritual-needs-permission.jpg)

### Whether it still works

The useful question about a ritual is not what happened last time — it's whether it has
quietly stopped working. Each one carries its recent outcomes and expands into them: what
happened, why, what it cost. When the last few runs in a row came to nothing, the row says
so, and says when it last worked.

A finished run is not automatically a successful one. A ritual refused a tool it needed
completes with half the job undone, so that counts against it. A run you stopped by hand
does not.

---

## Activity

Every run there has ever been — scheduled work, agent invocations and session turns —
with what it cost, how long it took and how it ended. Runs keep going if you close the
tab; the log replays for whoever attaches next.

Filter by what started it and how it ended, and search what a run *said* rather than only
what it was called. Searching covers the whole log, not the page of it on screen.

![Run history with cost, duration and outcome](docs/screenshots/09-activity.jpg)

---

## Backups

Your rituals and sessions only exist on this machine. They are snapshotted
automatically to a folder **outside** the app's own directory, so a backup survives that
directory being deleted — and can be restored from the same panel.

![Automatic snapshots of sessions and rituals](docs/screenshots/08-backups.jpg)

---

## Agents, commands and workflows

<table>
<tr>
<td width="50%"><img src="docs/screenshots/11-agents.jpg" alt="Agents with model tier and tool counts" /></td>
<td width="50%"><img src="docs/screenshots/12-commands-by-origin.jpg" alt="Commands grouped by origin" /></td>
</tr>
<tr>
<td><b>Agents</b> — what each one is for, which model tier it runs on, and how many tools it is allowed.</td>
<td><b>Commands</b> — grouped by where they come from, with their argument hints, so a plugin's command is never mistaken for yours.</td>
</tr>
</table>

**Workflows** chain agents into a pipeline. Each step is resolved to a real agent and the
model it will actually run on, so the cost of the whole thing is visible before you press Run.

![Chaining agents into a pipeline](docs/screenshots/13-workflow-builder.jpg)

---

## Also in the box

- **Skills** — write them, or import them from a GitHub repository by URL
- **Plugins** — browse registered marketplaces and install without leaving the app
- **Graph** — how your agents, commands, skills and plugins actually connect
- **Explore** — templates and community skills, in one place
- **Ask Claude** (`⌘J`) — a chat panel that knows about your configuration
- **Search** (`⌘K`) — across everything at once
- **Simple view** — hides the configuration concepts and leads with what you can run today
- **Dark mode** — from the sidebar, any time
- **Settings** — status line, extensions, GitHub imports, and the raw JSON when you want it

---

## Configuration

The Claude directory can be set from the sidebar at any time; the environment variables
are there for when you'd rather pin it.

| Variable | What it does | Default |
| --- | --- | --- |
| `CLAUDE_DIR` | Which Claude config directory to read and write | `~/.claude` |
| `PORT` | Port to serve on | `3000` |
| `HOST` | Host to bind | `0.0.0.0` |

---

## Development

```bash
bun run dev         # dev server
bun run test        # vitest
bun run typecheck   # nuxt typecheck
bun run build       # production build into .output/
```

### Demo data

The screenshots above come from a self-contained demo environment — its own Claude
directory and its own git repository, so nothing private can end up in a screenshot by
accident. Sessions in it get real worktrees, which is why the file counts, commit counts
and merge preview are real numbers rather than mock-ups.

```bash
node scripts/demo-data.mjs seed      # build it (~/.claude-demo)
CLAUDE_DIR=~/.claude-demo PORT=3200 node .output/server/index.mjs
node scripts/demo-data.mjs revert    # remove it again
```

### Tech stack

[Nuxt 3](https://nuxt.com) (v4 compatibility mode) · [Vue 3](https://vuejs.org) · [Nuxt UI](https://ui.nuxt.com) +
Tailwind CSS · [VueFlow](https://vueflow.dev) for the graph and the workflow canvas ·
[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) for runs ·
[Bun](https://bun.sh)

---

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
guidelines, and the [issues](https://github.com/davidrodriguezpozo/agents-ui/issues)
labelled `good first issue` for somewhere to start.

## License

[MIT](LICENSE)
