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
- **A bar in the margin** (`▌`) for the selected row, by the same argument
  applied to the one thing the glyphs did not cover. Selection was colour and
  weight only, so over a connection that has flattened the accent to a
  sixteen-colour approximation the cursor was invisible.
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

### Work (home)

```
  agents-studio                         1 need you · ~/code/agents-ui · main
  w Work 1   l Land   d Daily   m Fleet 1   i Inbox   p Projects

  In flight  3     History  11                                    1/3

  ▌ ● Waiting for permission   Fix the flaky terminal test          2m
      feat/flaky-test · 4 files · 3 turns
    ◐ Working                  Port the wall to a new grid         now
      feat/wall-grid · 11 files
    ● Ready to land            Cache the pull request lookup       18m
      feat/pr-cache · 2 files · checks pass

  ─────────────────────────────────────────────────────────────────────
  Fix the flaky terminal test
  Waiting for permission
  feat/flaky-test → main · 4 files, uncommitted
  ⏎ open   n new   tab history   o browser
```

### Fleet

```
  3 need you    4 working    1 broken    $2.40 today

  ─ Needs you  3 ──────────────────────────────────────────────────────
  ● Fix the flaky test                                       agents-ui  2m
    wants to run  gh pr create --fill
  ─ Working  4 ────────────────────────────────────────────────────────
  ◐ Port the wall                                            agents-ui  1:14
    Edited  app/pages/wall.vue

  agents-ui  Ran bun test   ·   agents-ui  Edited wall.ts
```

### A session

```
  ← Fix the flaky terminal test                  feat/flaky-test → main

  ● Needs you · 4 files · 2 ahead · checks failed 18m ago

  ─ you ──────────────────────────────────────────────────────────────
  The terminal test fails about one run in five on CI.

  ─ claude ───────────────────────────────────────────────────────────
  Read    …/test/terminal.test.ts
  Ran     bun run test terminal
  Edited  …/server/utils/terminal.ts

  It waits on a fixed 50ms timer for the shell to echo, so a loaded
  machine misses it…

  ┌ Allow this? ─────────────────────────────────────────────────────┐
  │ wants to run   gh pr create --fill                               │
  │ y once   a for this run   n deny   N deny and say why            │
  └──────────────────────────────────────────────────────────────────┘

  › _
  i write   d diff   c checks   f fix checks   x stop   s shell   o browser
```

Anything that spends money, writes to somebody else's repository or throws work
away asks first, in a framed question with the facts in it:

```
  ┌ Merge into main? ────────────────────────────────────────────────┐
  │ 3 commits from feat/flaky-test                                   │
  │ 2 uncommitted files, committed first                             │
  │ checks failing — this overrules them                             │
  │ y yes     n no                                                   │
  └──────────────────────────────────────────────────────────────────┘
```

Which ones those are is a field in the keymap rather than a decision at each
call site: closing a session asked all along, while merging a pull request and
filing one did not, and the only reason was the order they were written in.

### Daily

```
  ✓ Morning triage        every day at 08:00      ran 6h ago      $0.42
  ✓ Dependency sweep      Mondays at 09:00        ran 2d ago      $1.10
  ▲ Flaky test hunt       every day at 22:00      3 failures in a row
  ○ Changelog draft       Fridays at 17:00        disabled

  ↑↓ select   ⏎ history   e enable/disable   r run now   o browser
```

### Land

```
  2 on you    1 to merge    3 waiting

  ─ Asked of you  2 ───────────────────────────────────────────────────
  ● #407  Add sandbox violation reporting                 waiting on you
    marta · 8 files  +40/−12 · checks pass
  ─ Yours  3 ──────────────────────────────────────────────────────────
  ● #418  Cache the pull request lookup                   ready to merge
    yours · 12 files  +80/−12 · checks pass
```

## Keys

The table lives in `cli/keymap.ts`; this is it in prose. `?` prints the part of
it that applies to where you are, which is the part you wanted.

| Key | Everywhere |
| --- | --- |
| `h` `l` | Previous / next view |
| `g` + `w l d m i p` | Straight to Work · Land · Daily · Fleet · Inbox · Projects — the browser's own chords |
| `[` `]` | Previous / next project, for this window |
| `?` | The keys for where you are |
| `r` | Refresh now — everywhere, and only that |
| `o` | Open the current thing in the browser |
| `q` | Quit from a list, back out of a session, the way `less` does |
| `ctrl-c` | Quit |

| Key | Moving, in a list or a transcript |
| --- | --- |
| `j` `k` / `↑↓` | One row, or one line |
| `5j` | Five of them — counts work on `j`, `k` and `G` |
| `g g` | First row, oldest line |
| `G` | Last row, newest line, or the nth with a count |
| `⌃d` `⌃u` | Half a screen |

Worked out once, in `App`, and published to whatever has the screen — so a count
means the same thing to a list of sessions and to a transcript. Digits are counts
rather than view numbers, which is why the tab strip prints `w Work` and not
`1 Work`: a digit cannot be both a count and a destination, and `g w` is the
chord the browser already has.

| Key | In a list | | Key | In a session |
| --- | --- | --- | --- | --- |
| `⏎` | Open | | `i` | Write an instruction |
| `/` | Filter — the server searches history | | `esc` | Back |
| `n` | New session | | `d` | Diff, `tab` by file |
| `a` | Continue a terminal conversation | | `c` `f` | Checks · have it fix them |
| `tab` | In-flight / history | | `u` `t` | Catch up with base · trust |
| `R` | Run it now, or look again — asks first | | `x` `s` `e` | Stop · shell · `$EDITOR` |
| `e` | Enable or disable a ritual | | `p` `m` `D` | Pull request · merge · close — each asks first |
| `S` | Make this project the app default | | `y` `a` `n` `N` | Allow once · for the run · deny · deny and say why |

## Files

```
cli/
├── index.tsx          entry — arguments, connect, render or print
├── args.ts            the command line (pure)
├── commands.ts        the one-shot answers, and their exit codes
├── keymap.ts          every key, once (pure)
├── client.ts          HTTP and event streams
├── connect.ts         find the server, or start one
├── cwd.ts             which project you are standing in (pure)
├── notify.ts          the notification stream, the bell
├── runStream.ts       run events → LiveRun, and the reconnect (pure)
├── transcript.ts      session + run → drawable lines (pure)
├── diff.ts            a patch as the files it is made of (pure)
├── format.ts          wrap, truncate, scroll, tone (pure)
├── types.ts           the shapes the API returns
├── shell.ts           suspend for $SHELL, $EDITOR, browser
├── stubs/             build-time shim for Ink's devtools
└── ui/
    ├── App.tsx        views, the keyboard, layout, scope
    ├── theme.ts       accent, glyphs, columns, chrome
    ├── hooks.ts       polling, keyed actions, motions, scroll
    ├── components.tsx tabs, rows, inspector, meters, confirmations
    ├── WorkView.tsx · SessionDetailView.tsx · FleetView.tsx
    ├── RitualsView.tsx · LandView.tsx
    ├── InboxView.tsx · ProjectsView.tsx
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
  global handler, everything dangerous marked as asking first, and a hint for a
  key that does not exist throwing rather than printing a blank.
- `args` — the whole command line: unknown options refused, a bad port refused,
  an unquoted instruction read as one instruction.
- `commands` — the exit codes, against a stub API. `2` when something needs you
  is the contract a shell depends on, and it is one `if` away from being wrong.
- **The app itself, on a fake terminal.** Ink renders to any stream, so `App` is
  mounted on a pair of fakes and typed at: `⏎` opens the selected session, `esc`
  comes back, `q` in a session goes back rather than quitting, `g d` reaches
  Daily without the `d` also reaching the list underneath, and — the two that
  matter most — a permission prompt can be answered *while the checks are
  running*, and it leaves the screen the moment it is answered.

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
- **Two clients, one server.** Nothing here writes shared state without being
  asked — scope is a header, not a PUT — but the app's active project is still
  global, and `S` is how you move it on purpose.
