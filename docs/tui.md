# A terminal app for Agents Studio

`agents-studio tui` — everything the browser does, from the terminal you are
already in — and `agents-studio work`, for the times you do not even want that.

## Why

The work this app manages happens in a terminal, and so does most of the work
around it. Opening a browser to answer "did the 08:00 ritual pass" or to approve
one tool call is a context switch out of the place you were already working, and
back again. The app is local, has no authentication, and already exposes every
capability over HTTP — so the browser is one possible front end rather than the
only one.

The goal is not a viewer. It is the daily loop — see what needs you, answer it,
send the next instruction, land the work — without opening a URL.

## Principles

1. **A second client, not a second implementation.** Every list and every action
   is an existing endpoint under `server/api`. No logic is reimplemented here.
2. **Reuse the tested vocabulary.** `sessionBadge`, `toolCalls`, `time` and
   `errors` are pure and already decide what things are called. A session that
   says "Checks pass" in the browser says exactly that here, because it is the
   same function deciding.
3. **Port what ports.** Some things are worse in a terminal and are handled
   differently on purpose rather than badly. Being honest about that is what
   keeps the rest good.
4. **Clean and quiet.** One accent colour, one framed element, alignment doing
   the work that boxes would otherwise do badly.
5. **Told, not polled.** The server already publishes what happened. A client
   that listens refreshes on the news and lets its timers go slack — which is
   the difference between a program you leave open all day and one you close
   because the fans came on.
6. **A CLI, not only a TUI.** A terminal's advantage over a tab is the other
   programs in it. Every list here is one endpoint, so `work --json | jq` and an
   exit status meaning "something wants you" cost almost nothing, and make the
   whole app scriptable.
7. **Focus, not navigation.** Pages are cheap in a browser because a sidebar
   makes them cheap. In a terminal the good tools — lazygit, k9s, tig — move
   focus between panes that are all on screen and filter one list rather than
   maintaining six. So: one rail that never goes away, and the pane beside it
   shows whatever it is pointing at.
8. **One decision at a time, for the things that come in a stream.** Permission
   prompts arrive continuously when several agents are running. Answering them
   one screen at a time, from anywhere, is the thing a terminal does better than
   a tab — see the queue below.

## Architecture

```
bin/start.mjs  tui  ─▶  .output/cli/index.mjs  ─▶  http://127.0.0.1:3000/api/*
                            (Ink)                        (the same server
                                                          the browser uses)
```

- **Transport.** `cli/client.ts` — JSON requests plus a reader for the server's
  `data: {json}` event streams. Runs, terminals and notifications all use that
  one shape, so one reader serves them all.
- **Notifications.** `/api/notifications/stream` is the pipe the browser tab
  listens to, in the same frame shape, with a replay cursor for a reconnect.
  Two things come of subscribing: every pane refreshes the moment the server has
  news, and the terminal rings — a bell, and an OSC 9 banner for the terminals
  that understand one — when something is blocked on a person. `needsYou` only:
  a bell for every finished run is a bell you switch off, and then the one that
  mattered is off too.
- **Polling.** Fast while something is moving, slow when nothing is. The
  browser's work page has had this rule all along, because the session list costs
  several `git` invocations per session; this shares it, and the notification
  stream covers the gap a slack timer would otherwise leave.
- **The whole screen.** The app enters the alternate buffer, like `vim` and
  `less`, and leaves it however the process ends. Ink otherwise draws in the main
  buffer by moving the cursor up and erasing, which is right for a progress bar
  and wrong for something that fills the window: a resize, or anything else
  printing to the same buffer, leaves residue that the next frame draws *over*.
  Quitting now restores the scrollback exactly as it was, and handing the
  terminal to `$SHELL` means stepping out of our screen rather than into another
  one.
- **Authentication.** None needed, and none invented.
  `server/middleware/sameOrigin.ts` deliberately lets a request with no `Origin`
  and no `Sec-Fetch-Site` through: that is curl, an editor extension, or this —
  another program already running as you, which is the trust boundary the app
  has always had. The check it does *not* waive is the host one, so the client
  addresses the server as loopback.
- **Project scope.** The `x-project-dir` header, read fresh per request, because
  switching project is something you do while the app is open. Run inside a
  repository and that is the repository it looks at — `git` taught everybody to
  expect that. `[`/`]` and `⏎` on Projects move *this* client only; `S` also
  writes the app's default. Cycling used to PUT that default, which moved the
  browser's floor from a key you press while looking around. The header is set
  during render rather than in an effect, because a child's effect fires its
  first request before the parent's runs — which is how a list ends up showing
  another repository's sessions under this one's name.
- **Bootstrap.** Probe `/api/system/health`; if nothing answers, start the built
  server detached and wait for it. Whatever it starts is left running on exit —
  quitting the terminal app should not stop the thing running your rituals.
- **State.** `cli/runStream.ts` folds run events into a `LiveRun` exactly as
  `useRuns` does in the browser, as a pure reducer so it can be tested against a
  recorded stream. `followRun` wraps it with the reconnect the endpoint was
  always built for: `?after=<lastSeq>` replays only what was missed, so a
  dropped stream resumes instead of quietly falling back to the poll.
- **Keys.** `cli/keymap.ts` is the one table. The footer line, each inspector's
  hint and the help page all read it, because three copies of that is how a key
  ends up documented and dead — the same reason the browser keeps its keyboard
  in `app/utils/shortcuts.ts`. Asking for a key that does not exist throws, in a
  test rather than on screen.

## The shape of it

```
  RAIL  Needs you                         4 new · $2.40 · ~/code/agents-ui · main

  NEEDS YOU  6                  1/6    Fix the flaky terminal test    feat/flaky → main

  ─ Needs you  2 ──────────────────     ● Needs you · 4 files · 2 ahead · checks failed
  ▌ ▲  Fix the flaky terminal test
      Checks fail · feat/flaky          ─ you ────────────────────────────────────────
                                        The terminal test fails one run in five on CI.
  · ▲  Port the wall to a grid
      Working · feat/wall-grid          ─ claude ─────────────────────────────────────
                                        Read    test/terminal.test.ts
  ─ Broken  4 ─────────────────────     Ran     bun test terminal
    ✕  Morning triage
      3 failed · every day at 08:00     It waits on a fixed 50ms timer, so a loaded
                                        machine misses it…
    ✕  #418 Cache the pull lookup       $0.42 · 16.5s
      failing · marta · 12 files
                                        ›  i to write
    12 more                             i write   I $EDITOR   d diff   c checks   f fix

  tab focus   esc rail   Y answer all   : command   ? keys
```

The rail is everything that might want you — sessions, runs, pull requests,
rituals, what is waiting elsewhere, and the projects themselves — grouped by how
much it wants you rather than by which page it used to live on. `Work`, `Land`,
`Daily` and `Inbox` are filters on it, reached with `g` and a letter, and they
are the same list underneath.

A bar in the margin is the cursor; a dot is a row that has said something since
you last looked at it. `tab` moves the keys between the rail and the pane, so
switching between two running agents is a keypress rather than a trip out to a
list and back. Below a hundred columns the two take turns instead of sharing,
which is the behaviour the six views had all along.

`Fleet` is still a whole screen of its own, because it is a different job:
ambient rather than interactive, the thing you leave on a second monitor.

## Answering, as a queue

```
  ANSWERING                                                        3 waiting · s skips

  Fix the flaky terminal test          agents-ui · feat/flaky
  wants to run  gh pr create --fill

  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ gh pr create --fill --base main                                              │
  │ open a pull request for the flaky-test fix                                   │
  └──────────────────────────────────────────────────────────────────────────────┘

  y once   a for the run   n deny   N say why   s skip   ⏎ open   esc leave
```

`Y` from anywhere. One prompt on screen, one key each way, and it advances by
itself — eleven prompts in eleven keystrokes without choosing where to look.
`git add -p` solved this shape of problem a long time ago.

It shows the command it would run, or the lines it would write, because "allow
this?" with no sight of what would happen is the question the queue exists to
stop asking. The wall reports every prompt on the machine, across projects,
which is the right scope: being blocked somewhere else is still being blocked.

## Scope

### Ported

| Area | What you can do |
| --- | --- |
| Work | Sessions and runs as one list, in-flight vs history; start a session, continue a conversation you had in a terminal, open one, read the transcript, send a turn, answer prompts or deny with a reason, run checks, have it fix its own checks, catch up with the base branch, change how much it is trusted, read the diff a file at a time, stop a run |
| Land | Pull requests with your name on them, grouped as asked-of-you vs yours; merge one, or start a session on one |
| Daily | What is scheduled, when it next fires, what it last did, whether the scheduler paused it; enable, disable, run now |
| Fleet | Mission control: spend and quota meters, tiles grouped by urgency, ticker, upcoming rituals; answer a permission prompt or stop a run from the tile |
| Inbox | What is waiting elsewhere, and refresh a source |
| Projects | Switch the active project, or cycle with `[` `]` from anywhere |

### Outside the app

The same endpoints, printed once and exited — for a prompt segment, a git hook,
or the question you did not want to open anything to answer.

```
agents-studio work        what is in flight here, and what wants you
agents-studio land        pull requests with your name on them
agents-studio daily       rituals: when they fire, how they went
agents-studio fleet       everything running, and what today cost
agents-studio inbox       what is waiting elsewhere
agents-studio new <text>  start a session on it
agents-studio watch       follow what happens, a line at a time
```

`--json` for a pipe, `--quiet` for nothing but an exit status, `--project` to ask
about somewhere else. `0` is fine, `1` went wrong, `2` means something is waiting
on you — the one bit a shell wants to branch on:

```bash
agents-studio work -q || notify-send "something needs you"
```

No colour and no cursor tricks: this output is as likely to be read by `grep` as
by a person, and lines are clipped to the terminal only when a person is reading
them. Unknown arguments are an error rather than a shrug — `tui fleet` used to
open Work and `--port abc` used to mean 3000.

### Adapted, on purpose

- **Session shell** — drops you into a real `$SHELL` in the worktree rather than
  embedding a terminal emulator inside a terminal. The TUI suspends and resumes
  when you exit.
- **File editing** — `e` opens `$EDITOR` in the worktree, next to `s` for a
  shell. A young in-app editor is worth having in a browser, where there is no
  alternative. In a terminal there already is one.
- **Anything genuinely visual** — `o` opens the browser at the same page.

### Left out

Preview, the graph, marketplace browsing. Each is a rendered web page, and
none of them survives the trip. The wall ticker does: it is a line of verbs
along the bottom of Fleet.

## Visual design

Terminal UIs go wrong by decorating. The look here comes from restraint:

- **One accent** (`#7b7bea`, the product's indigo) for the selected row and for
  anything waiting on you. Grey for chrome, white for content, and nothing else
  competing.
- **One frame in the whole app**, around the permission prompt — so when a box
  does appear, it means something.
- **A glyph gutter** carrying state as shape as well as colour: `●` needs you,
  `◐` working, `✓` pass, `✕` failed, `▲` warning, `○` quiet. Colour alone says
  nothing on a monochrome terminal or to a red-green colourblind reader.
- **The selected row is reversed out**, and carries a bar in the margin (`▌`)
  when the rail has the keyboard, a thin one (`│`) when it does not. Selection
  used to be colour and weight alone, which is too subtle at the bottom of a long
  rail and invisible the moment anything else has gone wrong on screen. Inverse
  video is the one thing every terminal draws the same way, and it is what `fzf`
  and `lazygit` use for the same job.
- **A dot in the margin** for a row that has said something since you last looked
  at it. Same column as the cursor, because a row you are reading cannot also be
  unread.
- **Counts coloured by what they mean**, not by whether their tab is selected.
  The old rule tied the badge to selection, so "3 need you" sitting on another
  tab was the same grey as the chrome around it — which is exactly the case a
  badge is for.
- **Where you are in the list**, right-aligned beside the chips. A window onto
  eleven rows that shows eight and says so is a list; one that does not is a
  mystery.
- **Chrome measured, not guessed.** Every view used to carry its own number for
  how much of the screen was not list — 11 here, 14 there, `rows - 12` in the
  session pane — and a guess two out overflows the frame, which in Ink means the
  terminal scrolls and half the last frame stays above the new one. The pieces
  are named in `theme.ts` and added up.
- **A message line that is always there**, whether or not it has anything to
  say, so a pane does not resize under you when something reports. With a
  spinner while an action is in the air: "Running the checks…" as static text
  for four minutes is indistinguishable from a wedged program.
- **Lists never wrap.** Two-line rows: a title and a reason to pick it.
  Titles truncate with `…`; metadata right-aligns in dim.
- **An inspector** for the selected row — beside the list when the terminal is
  wide, under it when it is not. A view that is only a list of names is a
  command palette.
- **Empty states are a sentence and the key that fixes it**, never a blank pane.
- **A braille spinner** for live work. No emoji anywhere.
- **Markdown rendered, not printed.** Everything an agent writes is Markdown, and
  a pane that shows `###` and backticks shows you the punctuation instead of the
  point — a review with six sections and forty backticked identifiers is genuinely
  harder to read as source than as prose. `cli/markdown.ts` turns the handful of
  constructs that actually turn up in a transcript into weight and colour:
  headings bold, code green, lists as `•`, fences verbatim and never re-wrapped,
  links as their text. Deliberately not an implementation of Markdown — anything
  it does not recognise passes through and still reads, which is the failure mode
  to aim for.

### What a person configures

- **`~/.claude/agents-studio/keys.json`** — `{ "session.checks": "C" }`, a binding
  id and what to press. The keymap was already data; this is a file read rather
  than a feature, and the help page and the footers print whatever they find
  there because they read the same binding the handler does. A broken file is
  ignored with a line on stderr: losing a remap is a small disappointment,
  refusing to start over a stray comma is a big one.
- **`$EDITOR`** — `I` writes the instruction in it, on a Markdown scratch file,
  and sends what was saved. `git commit` settled this argument long ago: a
  one-line field inside a terminal app will never be good at prose, and a
  non-zero exit means "forget it".
- **`delta`, `diff-so-fancy` or `bat`** — used for the diff if one is installed,
  because somebody who installed `delta` has already decided how a diff should
  look and three colours of our own is a worse version of a thing they chose.
  `AGENTS_STUDIO_DIFF` picks one, takes its own flags, or `none` keeps the
  built-in colouring.
- **`--no-bell`** — for people who share an office.

## Keys

The table lives in `cli/keymap.ts` and it is what answers them: a handler asks
`matches('session.checks', input, key)`, so remapping is a file rather than a
patch. `?` prints the part of it that applies to where you are, which is the part
you wanted.

| Key | Everywhere |
| --- | --- |
| `tab` / `⌃w` | Move the keys between the rail and the pane |
| `Y` | Answer everything that is waiting, one at a time |
| `:` | A command line — `:new`, `:only prs`, `:trust full`, `:merge --override` |
| `/` | Filter the rail by text |
| `g` + `a n s p d i j` | What the rail shows: everything, needs-you, sessions, pull requests, daily, elsewhere, projects |
| `g m` / `F` | The fleet, full screen |
| `⌃n` | Next row that has said something since you looked |
| `⌃o` `⌃i` | Back and forward, where you were |
| `[` `]` | Previous / next project, for this window |
| `r` | Refresh now |
| `o` | Open this in the browser |
| `?` | The keys for where you are |
| `q` | Quit from the rail; from a pane it hands the keys back |

| Key | Moving, anywhere |
| --- | --- |
| `j` `k` / `↑↓` | One row, or one line |
| `5j` | Five of them — counts work on `j`, `k` and `G` |
| `g g` | First row, oldest line |
| `G` | Last row, newest line, or the nth with a count |
| `⌃d` `⌃u` | Half a screen |

Worked out once, in `App`, and published to whatever has the keys — so a count
means the same thing to the rail and to a transcript. Digits are counts rather
than view numbers, which is why the rail advertises `g s` and not `1`: a digit
cannot be both a count and a destination.

| Key | In the rail | | Key | In a session |
| --- | --- | --- | --- | --- |
| `⏎` | Look at it in the pane | | `i` `I` | Write · write in `$EDITOR` |
| `n` `a` | New session · adopt a terminal one | | `d` | Diff, `n`/`N` by file |
| `x` | Stop a run · dismiss · no project | | `c` `f` | Checks · have it fix them |
| `e` `R` | A ritual on/off · run it now | | `u` `t` | Catch up with base · trust |
| `m` | Merge a pull request | | `x` `s` `e` | Stop · shell · `$EDITOR` |
| `S` | Make this project the app default | | `p` `m` `D` | Pull request · merge · close |
| | | | `y` `a` `n` `N` | Allow once · for the run · deny · deny and say why |
| | | | `esc` | Hand the keys back to the rail |

Everything that spends money, writes to somebody else's repository or throws
work away asks first, in a framed question with the facts in it. Which keys those
are is a field in the keymap rather than a decision at each call site.

## Files

```
cli/
├── index.tsx          entry — arguments, connect, render or print
├── args.ts            the command line (pure)
├── commands.ts        the one-shot answers, and their exit codes
├── keymap.ts          every key, and what answers it (pure)
├── keys.ts            a person's own keys, off disk
├── commandLine.ts     the `:` grammar (pure)
├── rail.ts            everything that might want you, as one list (pure)
├── prompts.ts         the queue of waiting prompts (pure)
├── client.ts          HTTP and event streams
├── connect.ts         find the server, or start one
├── cwd.ts             which project you are standing in (pure)
├── notify.ts          the notification stream, the bell
├── runStream.ts       run events → LiveRun, and the reconnect (pure)
├── transcript.ts      session + run → drawable lines (pure)
├── markdown.ts        headings, code and lists, as weight and colour (pure)
├── diff.ts            a patch as the files it is made of (pure)
├── diffTool.ts        delta / bat, if this machine has one
├── format.ts          wrap, truncate, scroll, tone (pure)
├── types.ts           the shapes the API returns
├── shell.ts           $SHELL, $EDITOR, the browser
├── test/              the client's own tests, inside its own tsconfig
└── ui/
    ├── App.tsx        the keyboard, the layout, the polls, the scope
    ├── Rail.tsx       the one list
    ├── PromptQueue.tsx one decision at a time
    ├── FleetView.tsx  the whole screen, for the ambient job
    ├── theme.ts       accent, glyphs, columns, and the height arithmetic
    ├── hooks.ts       polling, jobs, motions, scroll, unread, jumps
    ├── components.tsx status line, rail rows, command line, confirmations
    └── panes/         SessionPane · RunPane · PullPane · RitualPane ·
                       InboxPane · ProjectPane
scripts/build-cli.mjs  esbuild bundle, `--watch` while working on it
```

## Build and packaging

- **Ink 5 and React 18**, not the latest. Ink 7 requires Node 22; this package
  promises Node 18 in `engines` and the README, and narrowing who can install
  Agents Studio is too high a price for a newer renderer.
- **Bundled, not depended on.** `scripts/build-cli.mjs` inlines Ink, React and
  the yoga WASM into one `.output/cli/index.mjs` — the same reasoning that keeps
  the server's dependencies vendored: a published install resolves nothing and
  compiles nothing. Ink, React and esbuild stay `devDependencies`. Measured at
  1.5mb, against the ~19MB the package already is.
- **`nuxt build` chains into it**, so `make build`, `prepublishOnly` and
  `agents-studio install` all produce a CLI without anyone remembering to.
- **`cli/` gets its own tsconfig** (`jsx: react-jsx`) and is excluded from the
  root one, so `nuxt typecheck` does not try to check React JSX with Vue's
  settings. `typecheck` runs both.

## Testing

Vitest, on the parts that are pure — which is where the bugs that matter live —
and on the keyboard, which turned out to be reachable after all:

- `runStream` folded over a recorded event stream, including a replayed
  reconnect and a duplicated permission prompt.
- `followRun` — that a dropped stream resumes from `lastSeq` rather than
  replaying the transcript, that a throw is a reconnect and not an ending, and
  that an abort stops it dead.
- `transcript` — that a live run replaces its own recorded turn rather than
  appearing twice, that thinking shows only until there is an answer, and that a
  finished turn reports what it cost.
- `diff` — where each file starts, which one a line belongs to, and where `tab`
  goes from the middle of one.
- `format` — wrapping a word longer than the pane, the scroll window at both
  ends, truncation.
- `markdown` — that the punctuation goes and the emphasis stays, that a fence is
  literal, that a bullet's continuation lines up under its text, and that text
  with no markup in it comes out exactly as it went in.
- `keymap` — no duplicate key on a surface, nothing claiming `q` or `?` from the
  global handler, everything dangerous marked as asking first, a hint for a key
  that does not exist throwing rather than printing a blank, `ctrl+d` not
  matching a bare `d`, `R` not matching `r`, and an override moving both the
  binding and the way it is printed.
- `rail` — that what wants you sorts above what does not, that another project's
  sessions are not in it, that a filter shows one kind, and that "new" means the
  row has moved since you looked at it.
- `commandLine` — the whole grammar, including that every command `:help` offers
  has a branch that parses it.
- `prompts` — the queue oldest-first across projects, answered ones dropped, and
  an edit shown as the lines it would write rather than as a filename.
- `keys` and `diffTool` — a bad `keys.json` ignored rather than fatal, and a diff
  renderer that is not installed falling back rather than failing.
- `args` — the whole command line: unknown options refused, a bad port refused,
  an unquoted instruction read as one instruction.
- `commands` — the exit codes, against a stub API. `2` when something needs you
  is the contract a shell depends on, and it is one `if` away from being wrong.
- **The app itself, on a fake terminal.** Ink renders to any stream, so `App` is
  mounted on a pair of fakes and typed at: `⏎` moves the keys to the pane and
  `esc` gives them back, `tab` toggles, `q` in a pane hands them over rather than
  quitting, `g d` filters the rail without the `d` also reaching it, a narrow
  terminal takes turns instead of splitting, `Y` opens the queue and `y` answers
  the prompt it is showing, `N` denies with a reason, `:` runs a command and says
  what it does not understand, and a permission prompt can be answered *while the
  checks are running*.
- **That it fits.** The frame is measured at four terminal sizes, because the one
  arithmetic bug this app can have reads as corruption: Ink draws the overflow on
  top of what is already there, so a pane that thinks it has two rows more than
  it does writes its footer over its own last line. Height is exactly what cannot
  be eyeballed from a screenshot.

These live in `cli/test/` rather than the repository's `test/`, because `nuxt
typecheck` reads the whole tree with Vue's JSX settings: a test importing the Ink
app from `test/` drags every `.tsx` in the client into the wrong typechecker.
`cli/` is excluded there and checked by `tsc -p cli`, so its tests belong inside
that boundary.

What is still by hand: how it looks. Colour, alignment at odd widths, and
whether a pane breathes are not things an assertion has an opinion about.

## Order of work

- [x] **Foundation** — client, event streams, connect and bootstrap, bundling
      proven, theme and hooks.
- [x] **The sessions loop** — list, detail, transcript, streaming, composer,
      permission prompts, checks, diff, stop, close. The core of it.
- [x] **Work, Rituals, Projects** — history, schedules with enable/disable and
      run now, switching project.
- [x] **Land and Inbox** — pull requests with merge and work-on-it, what is
      waiting elsewhere.
- [x] **The terminal-native bits** — suspend into `$SHELL`, `$EDITOR`, `o` for
      the browser.
- [x] **Polish** — filter, help, resize behaviour, empty states.
- [x] **Tests and README.**

### Second pass

Read back against the browser it was ported from, which is the only way to find
the things that were never wrong on their own:

- [x] **The run a session follows.** It latched onto the first one, so a turn
      started anywhere else never streamed — and since prompts arrive on the
      stream, a session working on somebody else's instruction could not be
      unblocked from here at all.
- [x] **Keyed actions.** One busy flag meant running the checks swallowed every
      `y`, `x` and `i` for ten minutes, silently.
- [x] **Reconnect from `lastSeq`**, which the endpoint always supported and
      nothing sent.
- [x] **`inCurrentProject`**, which the server works out per request and this
      ignored, so Work mixed every project under one project's name.
- [x] **Polling that idles**, and a notification stream so that costs nothing.
- [x] **The keyboard in one place** — counts, `gg`, `G`, `⌃d`/`⌃u`, the
      browser's `g` chords, and no view-switching key firing from inside a
      session.
- [x] **Asking first** for merge, pull request, run-now and look-again; `r` back
      to meaning refresh everywhere.
- [x] **What the browser could do and this could not** — adopt a terminal
      conversation, deny with a reason, fix its own checks, catch up with the
      base branch, change trust, preview a merge, search all of history.
- [x] **One-shot commands** with exit codes, because a terminal has pipes.
- [x] **Markdown**, rendered rather than printed.

### The redesign

Read back against what a terminal is actually good at, rather than against the
browser:

- [x] **One rail instead of six views**, with the pane beside it — focus rather
      than navigation, and Work / Land / Daily / Inbox as filters on one list.
- [x] **The prompt queue**, which is the thing only a terminal does well.
- [x] **`$EDITOR` for the composer**, and `delta` for the diff: compose with the
      tools a person has already chosen.
- [x] **A `:` command line** for the long tail, discoverable by typing `:help`.
- [x] **Unread markers** and `⌃n`, because agents talk while you are reading
      something else and no page in the browser shows that well either.
- [x] **Background jobs** rather than one status line that can only describe
      whichever slow thing finished last.
- [x] **Remappable keys**, since the keymap is data and now answers the keys.
- [x] **A status line** that says which mode has the keyboard.

Left undone on purpose: numbered buffers and `⌃^`. With the rail always visible
and a jumplist on `⌃o`, they would be a second way to do the same thing.

## Risks

- **Suspending Ink for a shell** is the fiddliest part: raw mode off, stdin
  paused, and a clean redraw afterwards. The tree is hidden rather than
  unmounted now — returning from a shell used to drop you at the top of a
  transcript with your draft gone, because the whole subtree had been rebuilt.
  If the handshake misbehaves it degrades to printing the worktree path, which
  is still useful.
- **Ink 5 with React 18** pins us behind current. Fine while the package
  supports Node 18; revisit when that floor moves.
- **Wide and combining characters** break naive column maths. Truncation is
  centralised in `format.ts` so there is one place to fix it if it shows up.
- **The frame is a stream, and some bytes are commands.** A carriage return in
  a session's text snaps the terminal to column 0 mid-row, and everything after
  it overwrites the rail beside the pane; an escape sequence from a test runner
  recolours the rest of the screen. None of that is hypothetical — agents paste,
  tests print colour, progress bars are made of `\r`. Everything that arrives
  from the server goes through `plain()` in `format.ts` on its way to a `Text`,
  which turns a `\r` into the newline it was standing in for and drops the rest.
  The one exception is a patch that `delta` rendered, whose escape codes were
  asked for.
- **Ink's layout fails silently and destructively.** Yoga shrinks a flex child
  that does not fit, and Ink then draws the child's content anyway — one line on
  top of another. A two-line row squeezed to one renders its detail *over* its
  title, which on screen reads as "the titles are missing" and is impossible to
  diagnose from a screenshot. Everything with a fixed number of lines therefore
  says `flexShrink={0}`, and every box that can give says `overflow="hidden"`, so
  the failure is a clipped last row rather than garbage. There is a test for it,
  because it cannot be seen in a string of the right length.
- **Two clients, one server.** Nothing here writes shared state without being
  asked — scope is a header, not a PUT — but the app's active project is still
  global, and `S` is how you move it on purpose.
- **The rail asks more sources at once** than any single view did. Pull requests
  cost a `gh` call and the inbox costs an agent, so neither is polled while the
  rail is filtered elsewhere and the pane is showing neither. If that gating is
  ever loosened, this is where the bill shows up.
- **An external diff renderer is somebody else's program** in the middle of a
  frame. It is given four seconds and its output is thrown away on any failure,
  which is the cheapest honest contract available.
