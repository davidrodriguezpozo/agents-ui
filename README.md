<div align="center">

# Agents Studio

**A workbench for Claude Code.**

Run several sessions at once, put recurring work on a schedule,
and see everything Claude has done for you — without leaving the browser.

<a href="#quick-start">Quick start</a> ·
<a href="#projects">Projects</a> ·
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
| **Projects** | The repositories you work in — switch between them in a click |
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
npm install -g agents-studio
agents-studio
```

Open **http://localhost:3000**. Add the project you want to work on from the bottom
of the sidebar — that's the repository sessions will branch from. Add as many as you
work in; switching between them is a click.

To try it once without installing, `npx agents-studio` works too — though it re-downloads
about 19MB whenever the cache misses, so the global install is the better home for
something meant to keep running.

> **You'll need:** Node.js 18+, and Claude Code installed and signed in on this machine.
> Sessions, rituals and workflows run through the Claude Agent SDK and use that login;
> there is no separate key to set up. Nothing is compiled at install time — the package
> ships its own build with dependencies already inside it, so `npm install` has nothing
> to resolve.

<details>
<summary>From source instead</summary>

```bash
git clone https://github.com/davidrodriguezpozo/agents-ui.git
cd agents-ui
bun install
bun run dev
```

Wants [Bun](https://bun.sh), or Node.js 18+ with `npm` in place of `bun`.
</details>

### Leave it running

A ritual due at 08:00 only happens if something is running at 08:00, so a server you
started in a terminal yesterday is not enough.

```bash
agents-studio install     # start at login and after a crash
agents-studio status      # is it installed, is it answering
agents-studio uninstall   # stop doing that — nothing you own is touched
```

<details>
<summary>From a checkout</summary>

```bash
make service          # build, then start at login and after a crash
make service-status   # is it installed, is it answering
make service-logs     # follow what it is saying
make service-stop     # stop doing that — nothing you own is touched
```

Or without make — note the build first, since the service runs the build rather than
the dev server:

```bash
bun run build
node bin/start.mjs install
node bin/start.mjs status
node bin/start.mjs uninstall
```
</details>

It listens on `127.0.0.1`, so only this machine can reach it. That default is deliberate:
sessions and rituals run commands as you, with your Claude credentials, against your
repositories, and there is no authentication in front of any of it.

What *is* in front of it is a check that every request came from this app rather than
from a web page you happen to have open. Without it, a page you visited could quietly
submit a form to `localhost:3000` and have this run a shell command as you — a form post
needs no permission from the browser to be *sent*, only to be read, and the attacker does
not need to read the reply. Requests from another site are refused, and so is any request
addressed to a hostname this server does not recognise, which is what stops the same trick
being played through DNS. Other programs on your machine are unaffected: they already run
as you, which is the boundary this has always had.

If you reach it through a proxy or a tunnel under your own name, tell it so:

```bash
AGENTS_STUDIO_ALLOWED_HOSTS=studio.my-tunnel.dev agents-studio install
```

To reach it from another device — your phone, say — bind it wider on purpose:

```bash
HOST=0.0.0.0 agents-studio install
```

and understand that on a shared network, anyone who can reach the port can do everything
you can.

If something else already has port 3000 — a Docker container publishing it is the usual
culprit — install refuses and names the occupant, rather than registering a service that
would fail to bind and be restarted forever. Pick another port with `PORT=3001
agents-studio install`; it is written into the service definition, so `agents-studio
status` keeps reporting on the right one afterwards.

Installing is a **deploy**: the build is copied to `~/.claude/agents-ui/installed-build/`
and the service runs the copy. That matters most from a checkout, where `bun run build`
empties `.output` and rewrites it over about a minute — a service running from there would
die on the next chunk it loaded, so working on the code would take down the thing running
your rituals. Run `make service` again to deploy what you have just built. Installed from
npm there is nothing to rebuild; `npm update -g agents-studio` then `agents-studio install`
deploys the new release.

This registers a launchd agent on macOS or a systemd user unit on Linux, and captures the
`PATH` of the shell you install from — a service otherwise gets a bare one with no `claude`
in it, and every run would fail at 08:00 with nobody watching.

Two things it cannot do for you: it will not wake a sleeping machine (an overdue ritual
still fires if you open the lid within a couple of hours, and is skipped after that rather
than arriving at teatime), and it keeps serving the build it was installed against — so
after changing code, or after updating the package, install again.

---

## Projects

The repositories you work in, in a list at the bottom of the sidebar. Add one and it
stays; switching between them is a click, and each says what branch it is on and how
many sessions it holds.

The list lives on disk next to your sessions, not in the browser, so it survives closing
the tab and is the same list whichever browser you open. Removing one is removing a
bookmark: the repository, its worktrees and the sessions that branched from it are all
left exactly where they were.

One project is *active* at a time, because project-scoped configuration comes from
exactly one `.claude` directory and pretending otherwise would make "which agents do I
have" unanswerable. Everything that isn't configuration spans all of them:

- **Sessions** are grouped by repository, so work waiting on you in a project you are
  not currently in still says so — rather than being a title on a row with no status.
- **Rituals** are pinned to a repository, chosen when you write one and defaulting to
  the project you are in. Editing one from somewhere else changes its time, not where
  it runs. *No project* is available here too, for a ritual that works on your own
  configuration rather than on any one repository.
- **Checks** are set per project, as they always were.

**No project** is a real choice too, and the last item in the switcher. It works against
your personal `~/.claude` alone, which is what you want when the agents and skills you
are editing are not any one repository's.

---

## Sessions

Each session gets its own branch and its own checkout of your repository, so several
can run at the same time without overwriting each other. Nothing lands in your working
copy until you merge it.

Say what you want done and it starts — the session names itself from the instruction
rather than making you type the intent twice. **Start several at once** takes one
instruction per line and gives each its own branch, workspace and turn, so setting up
five parallel sessions costs one paste instead of five round trips. It counts them
before it does anything, and twenty is the ceiling — each one is a full checkout.

That splitting only happens in the batch box. Multi-line text in the ordinary one is a
single prompt, because turning a carefully written paragraph into eight sessions is not
a mistake worth discovering afterwards.

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
<td><b>Merge</b> tells you what is about to be brought across and into which branch, and whether the project's own checks pass, before it touches your checkout.</td>
</tr>
</table>

The conversation itself is rendered properly — headings, lists, tables and code, the way
the agent wrote them.

![A session's conversation](docs/screenshots/03-session-conversation.jpg)

### What it did

The list could always tell you a session changed four files across three turns. It could
never tell you *what it did* — which is the thing you need in order to decide whether to
look closer, and the only thing on the row a non-programmer can act on.

So after a session changes something, a small model writes one sentence from its diff and
its closing message, and that sits on the row:

> **Add a maximum file size limit of 5MB to the upload…**
> Upload function now rejects files larger than 5MB.

It costs just under a cent per turn that changes files. That is small next to the turn
that produced the work but it is not nothing, so it can be turned off in Settings, and it
is reported on the spend page as its own **summary** line rather than disappearing into
the background — the honest way to let you decide whether it earns its keep.

### Whether it works

A diff tells you what changed. It does not tell you whether the result runs, and that is
the question almost everyone is actually asking — certainly anyone reviewing six sessions
at once, and anyone who does not read diffs for a living.

So your project's own checks run in the session's workspace, after any turn that changed
files. A turn that only answered a question doesn't trigger a test suite. The verdict goes
on the session, so the list says **Checks pass** or **Checks failed** rather than the
meaningless "changes ready", and a session that does not work sorts to the top with the
ones that need you.

**A failing session will not merge** until you say so. The merge dialog shows the failure
and offers *Merge anyway* — because sometimes the base branch is already red, and a gate
with no way through is a gate people route around. Taking it is recorded in the merge
commit, so "was this known to be broken when it landed" has an answer later.

Three distinctions it is careful about:

- **Failing is not the same as not running.** A workspace missing its dependencies, or a
  command that isn't on `PATH`, exits non-zero and means nothing about your code. Those
  are reported as having no verdict, and they never block a merge.
- **A verdict has a shelf life.** Edit the workspace after a run and the result is marked
  as describing code that no longer exists, rather than quietly believed.
- **Checks queue per repository.** Six sessions finishing together would otherwise build
  the same project six times at once, which thrashes the machine and breaks any suite
  that binds a port.

The command is guessed from your repository — a `check` target in your `Makefile`, a
`check` or `test` script in `package.json`, `Cargo.toml`, `go.mod`, `pytest` — and is set
per project in Settings. Telling it your project has no checks is a real answer, and it
stops asking.

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

### Being told

Work that carries on without you is only useful if it can reach you when it stops being
able to carry on. A blocked permission, a failure, or a turn that ran long enough that you
looked away each raise a **desktop** notification — not a browser one, because the browser
is usually shut, which is the case this exists for. Each kind can be turned off in Settings.

Meanwhile the sidebar counts what is stuck rather than what you own, and the tab title
carries that count too, so it's readable from another window.

---

## Activity

Every run there has ever been — scheduled work, agent invocations and session turns —
with what it cost, how long it took and how it ended. Runs keep going if you close the
tab; the log replays for whoever attaches next.

Filter by what started it and how it ended, and search what a run *said* rather than only
what it was called. Searching covers the whole log, not the page of it on screen.

![Run history with cost, duration and outcome](docs/screenshots/09-activity.jpg)

---

### Spending limits

The chart above says what a day cost, which answers the question a day late. Limits stop
things instead. Both are off until you set them, in Settings.

**Most per day** covers everything — sessions, rituals, summaries. Once reached, a session
refuses to start a turn and a ritual is skipped rather than run, each saying so plainly.
A skipped ritual moves on to its next occurrence without recording a run, so it does not
show up later as a ritual that has started failing.

**Most per run** is the only limit that can stop work part-way, and it is enforced by the
Agent SDK rather than by us — no price list here to go stale. It is checked between turns,
so a single expensive turn can overshoot it: a one cent limit stopped a run that had
already spent six. Read it as "stop after about this", not as a ceiling.

A run stopped by either is marked as needing you, keeps whatever it wrote, and records
what it spent — a limit whose own enforcement was invisible to the spend page would be a
poor limit.

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
make            # list every target
make setup      # install dependencies
make dev        # hot reload, on PORT (default 3000)
make check      # tests and typecheck, which is what CI runs
```

`make dev PORT=3001` if the background service already has 3000, and `PKG=npm` throughout
if you would rather not use Bun. Every target is a plain command you could type yourself —
the Makefile just remembers which ones need a build first.

### Demo data

The screenshots above come from a self-contained demo environment — its own Claude
directory and its own git repository, so nothing private can end up in a screenshot by
accident. Sessions in it get real worktrees, which is why the file counts, commit counts
and merge preview are real numbers rather than mock-ups.

```bash
make demo        # build it (~/.claude-demo) and serve it on 3200
make demo-stop   # remove it again
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
