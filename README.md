<div align="center">

# Agents Studio

**Leave Claude Code running.**

Work that fires on a schedule — or when a pull request opens — against your own
repositories, checks itself with your own tests, and stops when it can't. You come
back to what it did, what it cost, and what needs you. Then finish it without
leaving: edit the files, run a shell, see the app, and land it.

<a href="#quick-start">Quick start</a> ·
<a href="#daily-rituals">Rituals</a> ·
<a href="#sessions">Sessions</a> ·
<a href="#finishing-it-without-leaving">Workspace</a> ·
<a href="#whether-it-works">Verification</a> ·
<a href="#land">Land</a> ·
<a href="#handing-work-to-it">Hand-off</a> ·
<a href="#what-a-run-may-touch">Sandboxing</a> ·
<a href="#activity">Activity</a> ·
<a href="#alongside-claude-code-desktop">vs. Desktop</a> ·
<a href="CONTRIBUTING.md">Contributing</a>

<img src="https://img.shields.io/badge/license-MIT-5b5bd6?style=flat-square" alt="MIT licence" />
<img src="https://img.shields.io/badge/Nuxt-3-5b5bd6?style=flat-square" alt="Nuxt 3" />
<img src="https://img.shields.io/badge/runs-locally-5b5bd6?style=flat-square" alt="Runs locally" />

<br />

![Scheduled work, with what each run produced and which have quietly stopped working](docs/screenshots/06-daily-rituals.jpg)

</div>

---

Agents Studio reads the `.claude` directory you already have and the repositories you
point it at. Everything it shows you is a real file or a real branch; everything it
writes is something you could have written by hand. Close the app and nothing is
trapped inside it.

## Alongside Claude Code Desktop

| | Desktop | Here |
| --- | --- | --- |
| Work while you're there | ✅ and better at it | ✅ |
| Runs *your* test suite and blocks a merge on it | — | ✅ |
| Fixes its own failures, up to a limit you set | — | ✅ |
| Stops a scheduled job that has quietly broken | — | ✅ |
| Lands several finished branches in an order that accounts for each other | — | ✅ |
| Sandboxes what an unattended run may reach | — | ✅ |
| A daily spend cap that skips work rather than billing you | Quota display | ✅ |
| Holds work back when you're near your rate limit | Quota display | ✅ |
| Every repository at once, not one window's worth | — | ✅ |
| Fires at 08:00, or when a PR opens, against your local repo | Cloud routines | ✅ |

That last row is the one narrowing. Routines run in Anthropic's cloud, but self-hosted
environments now let Team and Enterprise plans run sessions on their own machines, and
that gap will keep closing. The rows above it are the ones to judge this on: none of
them are about *where* the work runs.

**On the workbench itself, Desktop is better and it is not close.** Panes you can
arrange, a proper diff viewer, an editor with everything an editor has. What is here is
enough to finish a piece of work without leaving — a file editor with syntax colouring, a
real shell, your app running in the page, and one click to put any of it back — and it is
a young version of all four. No bracket matching, no find-in-file, no debugger.

The argument for it is not that it beats Desktop at editing. It is that the work it
verifies, sandboxes and lands is already here, and walking across to another app to
change one line was the thing breaking that loop.

| Section | What it's for |
| --- | --- |
| **Daily** | Rituals — work on a schedule, retried when it blips, stopped when it breaks |
| **Sessions** | Several pieces of work at once, each on its own branch, each verified |
| **Activity** | Every run there has ever been, with cost, duration and outcome |
| **Workflows** | Agents chained into a pipeline, run to the end and kept |
| **Projects** | The repositories you work in — switch between them in a click |
| **Agents · Commands** | Subagents and slash commands, with where each came from |
| **Skills · Plugins · MCP** | What is installed, what it adds, and which of it actually works |
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

The same app, without a browser:

```bash
agents-studio tui
```

It talks to the local server — starts one if nothing is listening — and leaves it
running when you quit, so rituals keep firing. Run it inside a repository and it
opens on that repository.

One rail down the left holds everything that might want you — sessions, runs, pull
requests, rituals, what is waiting elsewhere — sorted by how much it wants you;
the pane beside it shows whatever the rail is pointing at. `tab` moves the keys
between them, `g` and a letter filters the rail (`g s` sessions, `g p` pull
requests, `g d` daily, `g m` the fleet), and `j`/`k`, `5j`, `gg`, `G`, `⌃d`/`⌃u`
move in either half. A dot in the margin is something that has spoken since you
last looked; `⌃n` goes to the next one. `?` lists the keys for wherever you are,
and `~/.claude/agents-studio/keys.json` remaps any of them.

**`Y` answers everything that is waiting**, one prompt at a time, showing the
command it would run or the lines it would write: `y` once, `a` for the rest of
the run, `n` no, `N` no and here is why, `s` skip. The terminal rings when
something is actually blocked on you.

`:` is a command line for the long tail — `:new fix the flaky test`, `:only prs`,
`:trust full`, `:merge --override`, `:help`. `I` writes an instruction in
`$EDITOR`, and if you have `delta` installed, diffs are rendered with it.

And because everything is an endpoint, it is scriptable:

```bash
agents-studio work                 # what is in flight here, and what wants you
agents-studio daily                # rituals: when they fire, how they went
agents-studio fleet --json | jq    # everything running, for a pipe
agents-studio new "fix the flaky test"
agents-studio watch                # follow what happens, a line at a time
```

Every one of those exits `2` when something is waiting on you, so a prompt segment
or a git hook can branch on it without parsing anything:

```bash
agents-studio work -q || echo "something needs you"
```

> **You'll need:** Node.js 18+, and Claude Code installed and signed in on this machine.
> Sessions, rituals and workflows run through the Claude Agent SDK, which spawns that
> Claude Code and uses that login; there is no separate key to set up. It is found on
> your `PATH` or where the installers put it — set `CLAUDE_CODE_EXECUTABLE` if yours
> lives somewhere unusual. Nothing is compiled at install time — the package ships its
> own build with dependencies already inside it, so `npm install` has nothing to resolve.

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
agents-studio tui         # the same app, in this terminal
agents-studio work        # or just the answer, without opening anything
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

### Doing something about it

Knowing was never the point on its own. A ritual that breaks on Tuesday used to go on
failing every morning, spending money to produce nothing, until somebody noticed.

**A failure gets one more go, ten minutes later.** Nobody is awake to press the button,
and losing the morning to a dropped connection is a poor reason to have no briefing. Only
a genuine failure, and only the first one — a run that was *refused a tool* is excluded
deliberately, because running it again produces the identical refusal a minute later, for
money. What that needs is the narrow rule it already offers you.

**After three runs in a row come to nothing, it stops firing** and says why. Stopping is
the useful act: it ends the waste, and it is the only way the next failure reaches anybody
instead of joining a queue of identical ones nobody reads. Turning it back on clears the
note — asking for it again is not the moment to bring up what it broke on last week.

### Being told

Work that carries on without you is only useful if it can reach you when it stops being
able to carry on. A blocked permission, a failure, or a turn that ran long enough that you
looked away each raise a notification. Each kind can be turned off in Settings.

**Your browser posts them**, once you allow it to — one click, on a button in Settings, and
nothing is sent anywhere: the banner is posted by the browser you are already sitting in
front of, over a connection this app holds open to itself. The reason is the click. A
notification is a thing you press to get back to the session that needs you, and a browser
notification has the tab: pressing it focuses the window you already had and opens the
session in it, without a reload and without a second copy of a page you were on.

The desktop banner is still there, one setting away, and it is the right choice if you
leave the browser shut — it is the only one that reaches you then. What it cannot do is
land the click. It belongs to an application, so on macOS it takes a small app bundle of
our own, built into `~/.claude/agents-ui/notifier` the first time anything is sent —
without it the banner is Script Editor's, its icon and a click that opens an empty script
window — and even with it, the best it can do is hand a link to whichever browser the
machine prefers. Choose **Both** if you would rather see two banners than miss one.

A banner about the page you are already looking at is suppressed, because the page is
already telling you. Two minutes of history are replayed to a tab that reconnects, so a
sleeping laptop loses nothing and a browser opened the next morning is not handed the
night's backlog. And **Send a test** in Settings goes down whichever channel is configured:
permission, Do Not Disturb and a blocked connection all fail silently, and none of them is
worth discovering by missing something at three in the morning.

Meanwhile the sidebar counts what is stuck rather than what you own, and the tab title
carries that count too, so it's readable from another window.

### The morning message

A notification catches you at the machine you were working on. The report it points at is
a page you have to be at that machine to open — which is the same sentence, aimed at the
thing it was meant to fix.

So the report can be **sent to Slack**: what needs you, what came out of it, what it cost,
in one message, through the Slack MCP server you already have set up. No token to paste,
nothing new stored, and the destination is somewhere you name — a channel, or a direct
message to yourself.

Four things it is careful about:

- **Nothing goes out on a quiet morning.** No runs, nothing missed, nothing waiting means
  no message. A daily "all quiet" is how a channel gets muted, and a muted channel is the
  whole feature lost. A skip is recorded and says so, rather than looking like a failure.
- **The schedule does not start until a send has worked.** Send one by hand first: that is
  what resolves your description of the destination into an actual channel, and it is the
  moment to notice it is the wrong one. Nothing gets automated before it is known to work.
- **The destination cannot drift.** After the first send, the channel *id* is what is used
  — the same words re-read on a different morning is exactly how a private report ends up
  somewhere public. Changing the destination means proving it again by hand.
- **It covers everything since you were last told**, not a fixed day, so a gap between
  messages does not become a gap in what you know. At least a day, at most a week.

The message is composed here and sent verbatim; the run that posts it is denied every other
way of writing to Slack, including scheduling a message that would outlive this app.

### Replying to it

The report arrives on a phone, on a train. The useful answer to *the rate limiting session's
checks are failing* is a sentence you could type there — so **a reply becomes a session**:
a branch, a worktree and an agent, started on the machine at home, with a note posted back
under your instruction saying what it started.

This is the most powerful thing in the app and it is off until you turn it on. A reply
becomes an agent with a shell on your repository, so the boundaries are the feature:

- **Only in a direct message.** Slack channel ids say what kind of conversation they are.
  In a DM with yourself there is no other author, so a command cannot be forged — by a
  colleague, or by text in a message crafted to make the reading model misreport who sent
  it. A channel can receive the report and can never command this. It refuses in words.
- **Only your own replies, only to the newest report.** The run that reads the thread holds
  one read tool and is denied every way of writing anywhere, Slack included; it is asked to
  transcribe rather than to interpret. Which replies count is then decided by code — author,
  cursor, and not-the-report-itself — never by a model.
- **Three at a time, ten a day**, and the daily spending cap applies as it does to any
  unattended work.
- **It lands in a session**, which is this app's existing answer to an agent nobody is
  watching: its own branch, its own checkout, nothing merged and nothing pushed until you
  say so.

What it cannot protect you from is your own instruction. A reply is treated exactly as
though you had typed it into the app, because that is what it is.

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

Four distinctions it is careful about:

- **Failing is not the same as not running.** A workspace missing its dependencies, or a
  command that isn't on `PATH`, exits non-zero and means nothing about your code. Those
  are reported as having no verdict, and they never block a merge.
- **A verdict has a shelf life.** Edit the workspace after a run and the result is marked
  as describing code that no longer exists, rather than quietly believed.
- **So does the base it was taken against.** Merge one session and every other one is
  suddenly verified against a `main` that no longer exists. Git will catch a textual
  conflict; it has nothing to say about one session renaming a function another one calls.
  Sessions show how far behind they are, and offer to bring the base in and re-check in
  one go.
- **Checks queue per repository.** Six sessions finishing together would otherwise build
  the same project six times at once, which thrashes the machine and breaks any suite
  that binds a port.

The command is guessed from your repository — a `check` target in your `Makefile`, a
`check` or `test` script in `package.json`, `Cargo.toml`, `go.mod`, `pytest` — and is set
per project in Settings. Telling it your project has no checks is a real answer, and it
stops asking.

### Making the workspace runnable first

A worktree is a bare checkout: the tracked files and nothing else. No `node_modules`, no
`.venv`, no generated types. So a check running there is being asked to test a workspace
that cannot run anything — and it fails in a way that looks like broken code rather than
a missing install.

It hides rather than failing loudly, too. Worktrees live inside the repository, so Node
walks up and finds the main checkout's dependencies by accident; the command half-starts
and then dies on something generated that isn't there. On the machine this was found on,
fifteen sessions had no verdict between them and nothing said why.

So a project has a **setup command** as well as a check command, guessed from your
lockfile and set in Settings beside it. It runs once per workspace, before the first
check — lazily, so starting a session stays instant and the minute it costs is paid when
something actually wants the answer.

### Finishing it without leaving

A diff tells you what changed. The checks tell you whether it still passes. Neither
answers *that is nearly right, let me change one line* — and the answer to that used to
be: find the worktree on disk, open your editor, open a terminal, start the dev server,
go to localhost. Four trips out of an app built so you would not have to make them.

A session opens on its conversation. One strip above it holds four views of the same
workspace, one at a time, and closing the one you are on gets you back to just the
conversation.

| | |
| --- | --- |
| **Changes** | The diff, per file, against where the session branched |
| **Files** | Browse and edit the workspace. A save lands in the session's branch exactly like something the agent wrote, so the checks go stale and want running again |
| **Terminal** | A real shell in the workspace, on the session's branch. It keeps running when you close the tab, because a long build should survive navigating away |
| **Preview** | Your project's dev command, on a port of its own, shown in the page |

![Editing a file in the session's own workspace, beside the tree and the diff](docs/screenshots/14-workspace-editor.jpg)

<table>
<tr>
<td width="50%"><img src="docs/screenshots/16-workspace-terminal.jpg" alt="A real shell in the session's workspace, on its own branch" /></td>
<td width="50%"><img src="docs/screenshots/15-workspace-preview.jpg" alt="The project's dev server running on its own port, shown in the page" /></td>
</tr>
<tr>
<td><b>A shell</b> in the workspace, on the session's branch — the same one the diff is about.</td>
<td><b>The app itself</b>, from this session's code, on a port of its own.</td>
</tr>
</table>

Each one is a *young* version of the thing it replaces — the editor colours nine
languages and numbers the lines, and that is the whole of it. What they are for is
finishing, not living in.

**Putting it back** sits beside the editor, because being able to change a file by hand
is what makes undo matter. Two things, kept apart: throw away what is uncommitted, or
take a whole turn off. Both name the files rather than counting them, and neither can
reach past the commit the session branched from — your repository's own history is not
this session's to undo.

The preview gets a port from the kernel rather than a guess, because several sessions
running at once is the point of worktrees and two dev servers fighting over 3000 is not.
It is handed over in `PORT`; a project that hardcodes one instead will have its sessions
collide, which the page says rather than pretends to have solved.

---

## Land

A session ends at a pull request, and that used to be where this app stopped looking. It
is not where the work stops. Somebody asks for a change on Tuesday, CI goes red on the
third push, a review is requested from you while you are inside something else — all of
it on github.com, which is a tab you have to remember to open.

**Land** is the page for everything with a diff behind it and a decision still to make. It
has two bands, because "this is finished, now what" gets asked of two different things and
used to be answered in two different places.

**Ready here** is the merge train: sessions on this machine whose branches can go into the
base without asking GitHub anything. It lived at the top of the Work page, nine rows tall,
pushing the box you start work in below the fold — and it was answering a different
question from everything around it.

**On GitHub** asks the two questions you open that tab for, in the project you are already
in: *what is waiting on me*, and *where has my own work got to*. Read through `gh`, with
the sign-in you already have — no token to paste, nothing stored, nothing listening on a
port.

Each pull request gets one verdict rather than eight fields to assemble yourself, and the
list is sorted by whether the next move is actually yours:

| | |
| --- | --- |
| **Conflicts** | It collides with its base, so nothing downstream of that means much |
| **Changes requested** | Somebody reviewed it and wants something — with how many threads are still open |
| **Unanswered** | Comments left on the diff that nobody has resolved |
| **CI red** | Which checks failed, by name, linked to the run |
| **Ready to merge** | Approved, green, mergeable — and it says so when nothing reported |
| **In review** | Waiting on a named reviewer. Not your problem this minute |

A person outranks a robot: a pull request that is both red *and* has a reviewer waiting
reads as the second, because only one of those is somebody sitting at the other end.

**Then the row turns into a session.** That is the part a list of links cannot do. One
press cuts a worktree with the pull request in it and starts a turn that knows why it is
there — read this diff and tell me what is wrong with it; work out why CI went red and
fix the failure rather than the check; do what the reviewer asked, and say so where you
think they are wrong. Nothing is posted to GitHub by any of them. The review comes back
into the session for you to read, because a review left under your name that you have not
read is the worst thing this could possibly do for you.

**And pressing it again works.** Git allows a branch in exactly one working copy, which
used to make a second press on the same row a dead end: "fatal: branch X is already
checked out at Y" — about the pull request you were looking at. A review does not commit
or push, so it no longer asks for the branch at all: it gets a detached checkout of the
head commit, named in the prompt, and any number of those can exist at once — including
while a session is fixing that same branch. The three actions that *do* change the branch
land in the workspace that already has it and continue that session, or take over one no
session claims any more, and the page says which of those happened. The only refusal left
is a branch held by a session mid-turn, or by your own checkout, and both name where it is
rather than leaving you to find it.

Merging is the exception and is treated like one: it only appears on your own pull
request, only when it is genuinely ready, and the page re-reads GitHub at the moment you
press it rather than trusting what it drew ten minutes ago.

The same rows can be reached by right-click from **Fleet**, which is how you act on one
without leaving a screen you left running. Every entry there that writes selects the right
project first and then calls this page's own route, so it re-reads the pull request before
it builds a prompt — the screen's minute-old copy decides what to offer, never what to do.

### When it lands

However it gets in, the session says so and says which way — merged into its base here, a
pull request this app merged once CI went green, or one you merged on github.com yourself
while it was watching. Three routes, one record, and the third is deliberately not reported
as work this machine did.

That sounds like bookkeeping and is the difference between a report you can read and one you
cannot. Nothing recorded a merge before: the branch went into `main` and the session went on
looking exactly as it had — idle, checks passing, work in flight — so *what shipped last
night*, the first thing anybody asks, was the one question with no answer anywhere. It is now
the top line of what came out of a night, in the app and in the message.

---

## Handing work to it

Everything above assumes you are the one doing the handing. The other way work arrives is
somebody else's issue — a colleague, a designer, whoever found the bug — and this section
is the whole of what that person needs to know.

**Put the label `studio` on a GitHub issue.** That is the convention. Anyone who can label
an issue in that repository can use it: no account here, nothing installed, no need to know
this app exists. The word itself is a setting, so a team that already means something by
`studio` picks another one.

Then, on the machine where this is running:

- **The issue turns up in [Land's issue band](#land)**, beside the pull requests, with one
  verdict — whether anybody has picked it up, whether it is waiting on a reply. That band
  asks GitHub the same way the pull-request band does, so a label added now shows up within
  a minute. And if a [ritual](#daily-rituals) is set to fire when an issue is labelled, it
  starts on its own within a couple of minutes, with nobody pressing anything.
- **One press turns the row into a session** — its own branch, its own checkout of the
  repository, and a first turn that has read the issue's title, body and comments. Two
  presses, in fact: *investigate and report*, which commits nothing, and *do it*.
- **Nothing is pushed and nothing is merged.** The work sits in a checkout on that one
  machine. Someone reads the diff, the [checks](#whether-it-works) have to pass, and that
  person merges it — the same route as [any other session](#sessions). Starting from an
  issue buys no exception.

An issue's text is written by whoever can reach the repository, so it is handed to the
session as the thing to read: quoted, in the prompt, and never into [the standing
brief](#what-a-run-knows-before-it-starts) or a system prompt. It is the same line the
standing brief draws — counts from outside cross it, prose does not.

So the expectation to give the person who filed it is *this gets looked at today, and a
person decides what happens to it*. Not that it is being handled.

### What it will not do to your issue

The issue belongs to whoever filed it, and a tool that quietly rewrites other people's
tickets is a tool that gets taken away. So there is exactly one write it can perform: **one
comment, once**, when a session started from that issue opens a pull request — what was
done in a sentence, the link, and that nobody has reviewed it yet. It is off until you turn
it on in Settings, and it is composed here and sent verbatim, by a run holding that one
tool and denied every other way of writing anywhere.

Everything else is not switched off, it is absent. It does not close your issue, reassign
it, edit the title or the body, add or remove a label, react to it, or answer a comment. If
the answer to your issue is *we are not going to do this*, that is still a sentence a
person has to write.

---

## What a run knows before it starts

The most expensive thing about work that runs without you is that every run begins knowing
nothing. A morning ritual rediscovers which branches are yours, what yesterday decided and
which of six sessions is the one that matters — every morning, at your expense, and it gets
it slightly differently right each time.

The **standing brief** is one page of that, handed to every run that starts cold. Work in
flight and what each session did, with the run's own repository first. What shipped in the
last two days, and by which route. Scheduled work that has stopped working. How much is
waiting elsewhere. And above all of it, the half you write: the standing facts nothing on
this machine can derive — Ana is out until September, the release goes out on Thursdays —
which is never overwritten by an assembly.

It is **read off files this machine already keeps, not written by a model**. That decides
two things. It cannot invent a branch, which a summary of your week eventually would; and it
is free, which is what lets it be attached to every run rather than to the ones something
decided were worth it. You can read the exact text a run receives, from the panel on Now,
because a description of what runs are told is a thing that can be wrong about it.

It is left off a conversation already under way. Prompt caching is prefix-based, so changing
the system prompt on turn nine means re-reading the whole conversation at full price — to
buy a fact the session was told on turn one. Rituals, workflow steps and the first turn of a
session are the cold starts, and they are what this is for.

One line it does not carry: the titles of what is waiting in Slack or Notion. Those are
written by anyone with access to a channel you are in, and this text goes into the system
prompt of a run that can edit files and execute commands. Counts cross that line; prose from
outside does not.

---

## What a run may touch

Sessions and rituals run shell commands as you. This is the thing that tells you to walk
away from one at 08:00, so **runs are sandboxed by default** — including in projects that
were set up before the setting existed. Commands reach only the hosts you list, and a run
cannot let *itself* out; widening is something you do in Settings, on purpose.

It pays twice. A sandboxed command does not need to stop and ask, so the failure this
spends the most effort on — a ritual back in the morning having been refused a tool, with
half its job undone — largely stops happening.

When something is refused, the run says which host it wanted, counts as needing you
rather than as a clean success, and offers to allow exactly that host in that repository.
A project with rituals that already ran is told all of this once, before anything breaks.

Your own checks are unaffected either way: those are commands you configured yourself,
and they run outside the sandbox. So does the terminal — a person typing into their own
shell is what the sandbox protects *from being impersonated*, not what it protects
against.

---

## Activity

The **History** tab of Work: every run there has ever been — scheduled work, agent
invocations and session turns — with what it cost, how long it took and how it ended,
under a chart of the night that shows *when* rather than merely what. Runs keep going if
you close the tab; the log replays for whoever attaches next.

It is a tab rather than a page because the other half — **In flight** — is the same list
asking the opposite question. A session you might still interrupt and a ritual that failed
on Tuesday are both work, but nobody looks for both at once, and in one list the finished
rows win on volume: forty of them, and the two you could act on at the bottom.

In flight does not mean "something is running". A session that answered your question,
committed nothing and opened no pull request has stopped, and is the most in-flight it will
ever be — the next thing due to happen is you typing. So the cut between the two tabs is
whether the work is *finished with*, and there are only three ways for a session to get
there: its commits land in the base branch, you set it aside from the session's own menu,
or it produced nothing at all and a week went by. Work sitting unmerged in a workspace
never ages out on its own, and sending a session an instruction pulls it back out of
History.

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
- **Version and updates** — which release you are on, and one click to a newer one
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
