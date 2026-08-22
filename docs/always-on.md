# The always-on runner

Everything scheduled in this app runs while the app is running, and by default that
means while your laptop is open. A ritual due at 08:00 on a shut machine is not a
ritual that failed — nothing was attempted — but it is also not a briefing you can
read at 08:05.

This is how to put it on a machine that is always awake: a Mac mini in a cupboard, a
small Linux box, a VM somebody else keeps powered. One document, followed top to
bottom, ending with rituals that fire overnight and a page you can open from your
desk in the morning.

It pairs with hosted runners rather than competing with them. A hosted runner
executes a job somebody already decided to run; this decides what is worth running,
against your own repositories, gated on your own tests — and then needs somewhere to
be awake at 03:00 like anything else does.

> **Read this first if you only read one thing.** The runner runs shell commands as
> the user it is installed under, with that user's git and GitHub credentials, and it
> is reachable over HTTP with no authentication of its own. Everything below about
> `HOST` and about which repositories it checks out follows from that one fact.

---

## 1 · What you need on the machine

Nothing is compiled and there is no database. The list is short and every item is
load-bearing:

| | Why |
| --- | --- |
| **Node 22 or newer** | The server is plain Node. `node --version`. |
| **Claude Code**, signed in | The runner spawns it for every turn. `claude --version`, then run `claude` once by hand so the login is done. |
| **git** | Worktrees, merges, everything on Land. |
| **`gh`**, signed in *(optional)* | Only for the GitHub half: pull requests, issues, CI status. `gh auth status`. |
| **A user account you are happy to be** | See the warning above. Not root. |

The machine does **not** need to be reachable from the internet, and should not be.

## 2 · Install it

From npm, as the user the runner will be:

```sh
npm install -g agents-studio
agents-studio install
```

From a checkout, if you are working on the code:

```sh
make service              # builds first, then installs
```

`install` is idempotent — it is also how you deploy a new build — and it checks the
one thing that would otherwise fail invisibly: whether the port is free. If something
else holds it, install refuses and changes nothing. It names the occupant when it can
work out who that is, which needs `lsof` on the machine; without it you get the
refusal and no name. Pick another port:

```sh
agents-studio install PORT=3001      # from npm
make service PORT=3001               # from a checkout
```

What it just did, on both platforms:

- Copied the build to `~/.claude/agents-ui/installed-build` and pointed the service
  at **that copy**. Rebuilding in a checkout therefore cannot disturb a running
  service — `.output` is emptied and rewritten over about a minute, and a service
  reading from it would die on the next chunk it loaded.
- Captured the `PATH` of the shell you installed from. A service otherwise gets a
  bare one with no `claude` in it, and every run would fail at 08:00 with nobody
  watching.
- Registered a supervisor definition that restarts the process if it exits:
  - **macOS** — `~/Library/LaunchAgents/com.agents-ui.server.plist`, `RunAtLoad` and
    `KeepAlive`.
  - **Linux** — `~/.config/systemd/user/agents-ui.service`, `Restart=always`,
    `RestartSec=5`.

**If your Linux has no `systemd`** — a container, or a distribution using something
else — `install` fails at the last step with `systemctl refused to start it`, having
already copied the build to `~/.claude/agents-ui/installed-build`. Nothing is
running and nothing is registered, but `agents-studio status` will report a deployed
build from then on. Run the server under whatever supervisor the machine does have,
pointed at the same command the unit file uses:

```sh
node ~/.claude/agents-ui/installed-build/server/index.mjs
```

Then check it:

```sh
agents-studio status
```

```
service    installed
build      deployed 22/08/2026, 09:14:02
responding yes — http://localhost:3000
logs       /home/runner/.claude/agents-ui/logs/service.log
```

If install went wrong, the same command is what says so:

```
service    not installed
build      deployed 22/08/2026, 09:14:02
responding no on port 3000
logs       (none yet)
```

If it says `installed` and `responding no`, it prints the last few log lines and
names whatever is holding the port. That is the whole diagnosis, in one command.

### On Linux, do this or it will not survive a logout

A `systemctl --user` service stops when the user's session ends — which includes
logging out of SSH, and includes a reboot:

```sh
loginctl enable-linger $USER
```

The installer prints this too. **This is the single most common way an always-on
runner turns out not to be**: everything works, you log out, and the next morning has
no briefing in it and nothing anywhere saying why.

## 3 · Where state lives, and `CLAUDE_DIR`

Everything the app knows is files under one directory:

```
~/.claude/agents-ui/           rituals, sessions, run history, preferences
~/.claude/agents-ui/logs/      service.log
~/.claude/agents-ui/installed-build/   the copy the service runs
~/.claude/agents-ui-backups/   snapshots, deliberately outside the directory above
<your repo>/.worktrees/        one workspace per session
```

`CLAUDE_DIR` moves the first four. It is **pinned into the service definition only if
it was set when you installed** — otherwise the service reads whatever `~/.claude` is,
exactly like running it by hand. So if the runner should keep its state on a
different disk:

```sh
CLAUDE_DIR=/srv/agents-studio agents-studio install
```

Two things follow that are easy to get wrong:

- Changing `CLAUDE_DIR` later means **installing again**. Editing the plist or unit by
  hand works until the next `install` overwrites it.
- The runner's `~/.claude` is not your laptop's. Its rituals, its sessions and its
  Claude Code login are its own. Nothing syncs between them except what you put in a
  repository — see [Mine and ours](../README.md#mine-and-ours) for the half that is
  meant to travel.

## 4 · `HOST`, and what binding beyond loopback means

By default the server binds `127.0.0.1` and is reachable from that machine only. To
open a page on it from your desk you have to change that, and the change is not a
detail:

```sh
HOST=0.0.0.0 agents-studio install
```

The installer says it plainly:

```
reachable   on 0.0.0.0 — ANYONE on your network can run commands as you
```

That is accurate. There is no login, no token and no per-user anything: the HTTP
interface starts sessions, runs shell commands and merges branches as the user the
service runs as. On a home network with one person on it, that may be a risk you are
happy with. On an office network it is not.

**The recommended answer is to leave it on loopback and reach it over SSH:**

```sh
ssh -N -L 3000:localhost:3000 runner.local
# then open http://localhost:3000 on your own machine
```

Nothing to configure, nothing new to authenticate, and it stops being reachable the
moment you close the tunnel. A Tailscale or WireGuard address in `HOST` is the same
idea with less typing and is equally fine — the thing to avoid is `0.0.0.0` on a
network you do not control.

## 5 · Which repositories it checks out

The runner works in real clones on its own disk. It does not share your laptop's.

```sh
mkdir -p ~/work && cd ~/work
git clone git@github.com:you/your-repo.git
```

Then add it as a project in the app (sidebar → pick a project), or let a session
start against it. Three things worth deciding now rather than at 03:00:

- **Sessions are worktrees inside the clone**, at `<repo>/.worktrees/<id>`. The app
  adds that path to the repository's `.git/info/exclude` so it never shows up as
  untracked.
- **The base branch is whatever the session was started from.** A runner that only
  ever lands on `main` should have a clone whose default branch is `main` and nothing
  checked out by hand — see the failure modes below for what a stray `gh pr checkout`
  in the main clone does.
- **A monorepo costs disk per session.** "Make the workspace runnable first" installs
  dependencies per worktree; on a large repository that is a gigabyte or two before a
  line is written.

### How it authenticates to GitHub

Whatever the service user's `gh` is signed in to. There is no token in this app's
settings and nothing to paste:

```sh
gh auth login          # as the runner user, once
gh auth status         # what the runner will be able to see
```

For a machine nobody logs into, `gh auth login --with-token < token` with a
fine-grained token is the usual answer. Give it the repositories the runner works on
and nothing else; it is exactly as powerful as the runner is.

Pushing uses git's own credentials — an SSH deploy key per repository is the tidiest
thing that works, and is what stops a runner being able to push to forty repositories
because one of them needed it.

## 6 · Capping what it can spend

A runner that nobody watches is the machine where a spend cap matters most, and the
caps are **off by default** (`0` means no cap). In Settings → Limits:

- **Daily cap** — once the day's spend reaches it, work is *skipped rather than
  queued*. A skipped ritual says so on its row; it does not pile up and fire at
  midnight.
- **Per-run cap** — stops one runaway turn, which is the failure a daily cap notices
  too late.
- **Maximum concurrent runs** — the disk and CPU knob as much as the money one. Six
  worktrees each running a test suite on a small box is how a machine stops answering.
- **Pause on a quota warning** — when the subscription's own limit is close, stop
  starting new work rather than filling the window with rituals.

These are per machine, in that machine's own `CLAUDE_DIR`. Setting them on your
laptop does nothing for the runner.

## 7 · When something goes wrong

Four failure modes, and where each one is visible. All four have been seen.

### The Claude Code login expired

**Looks like:** every run fails within seconds. Runs are in History with an
authentication error in their output; rituals accumulate a failing streak and,
after three, turn themselves off with a reason on the row.

**Where to look:** `agents-studio status` says `responding yes` — the app is fine,
it is Claude Code that is not. The run's own output is the answer.

**Fix:** as the runner user, `claude` once by hand and sign in again. Nothing in the
app needs restarting.

### The disk filled up with worktrees

**Looks like:** sessions fail to start, checks error rather than fail, git complains
about writing objects. The app's own store may fail to save, which reads as
preferences not sticking.

**Where to look:** `df -h`, then `du -sh <repo>/.worktrees/*`. Work is a page that
lists every session; the ones you closed months ago are the ones holding the disk.

**Fix:** close finished sessions in the app — it removes the worktree and prunes the
branch. `git worktree prune` in the clone clears anything left behind by a session
whose directory was deleted from underneath it.

### The machine rebooted and the service never came back

**Looks like:** nothing at all. No runs, no rituals, no error anywhere — the app is
not running to write one.

**Where to look:** `agents-studio status` from an SSH session. `service not
installed` on Linux almost always means linger was never enabled (§2).

**Fix:** `loginctl enable-linger $USER` on Linux; on macOS check the plist still
exists in `~/Library/LaunchAgents` and re-run `agents-studio install`. Then decide how
you would have found out — see *what this document cannot give you* below.

### Something else took the branch, or the checkout drifted

**Looks like:** a session reports thousands of changed files, or a merge refuses
because the base checkout is dirty or on the wrong branch. Bringing the base into
other sessions skips them with "its branch is checked out in …".

**Where to look:** the merge train on Land says the repository-level reason before
you press anything. `git -C <repo> status` and `git -C <repo> worktree list` are the
two commands that explain it.

**Fix:** put the main clone back on its default branch with a clean tree. The rule
for a runner is that nobody works in the main clone by hand — sessions get worktrees,
and the clone itself stays boring.

## 8 · Backups

Snapshots of rituals and sessions are written automatically to
`~/.claude/agents-ui-backups`, deliberately *outside* the app's own directory so that
deleting `agents-ui` does not take the backups with it. They are restorable from
Settings → Backups.

**They are still on the same disk.** For a machine you would be upset to lose, point
something at that directory — whatever you already use:

```sh
# whatever you already trust; the directory is small and plain JSON
restic backup ~/.claude/agents-ui-backups
rclone sync ~/.claude/agents-ui-backups remote:agents-studio-backups
```

What is worth backing up, in order: `agents-ui-backups` (rituals and sessions),
`agents-ui/preferences.json`, and nothing else — run history is large and
reconstructible, and worktrees are branches that live in git.

---

## What this document cannot give you

Honest gaps, not future work disguised as instructions:

- **There is no health check to point a monitor at.** `GET /api/health` does not
  exist; `agents-studio status` is a command on that machine. Until there is one, the
  answer to "how would I know it stopped" is that the morning message not arriving is
  the alarm — which works, and is slower than a monitor.
- **Backups off the machine are your tooling, not this app's.** Nothing here uploads
  anywhere, and there is no setting for it. The directory is plain JSON and small;
  that is the whole of the support.
- **`CLAUDE_DIR` is pinned at install time only.** Changing it is a reinstall, and
  nothing detects that the definition and your intent have diverged.
- **Nothing verifies the runner's credentials until they are needed.** An expired
  Claude Code login is discovered by the first ritual that fails, not before it.
- **A container is not a supported target.** The supervisor half of this document is
  launchd or systemd; a plain container has neither, and the app has no PID-1 story
  of its own. The rest of the document does hold there — an install from npm, a
  `CLAUDE_DIR`, a `HOST` and a server that answers were all followed in a clean
  `node:22-slim` while writing this.
- **The port refusal suggests a command an npm install does not have.** It prints
  `make service PORT=3001`, which is the checkout form; from a global install the
  equivalent is `agents-studio install PORT=3001`. A one-line fix in `bin/start.mjs`,
  and its own brief rather than a paragraph of apology here.
- **Nothing checks the prerequisites in §1.** A machine with no `git` and no `claude`
  installs, starts and answers `200`; the absence surfaces as the first ritual
  failing. Observed, not assumed — that is exactly what the container did.
