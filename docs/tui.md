# A terminal app for Agents Studio

`agents-studio tui` — everything the browser does, from the terminal you are
already in.

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

## Architecture

```
bin/start.mjs  tui  ─▶  .output/cli/index.mjs  ─▶  http://127.0.0.1:3000/api/*
                            (Ink)                        (the same server
                                                          the browser uses)
```

- **Transport.** `cli/client.ts` — JSON requests plus a reader for the server's
  `data: {json}` event streams. Runs, terminals and notifications all use that
  one shape, so one reader serves them all.
- **Authentication.** None needed, and none invented.
  `server/middleware/sameOrigin.ts` deliberately lets a request with no `Origin`
  and no `Sec-Fetch-Site` through: that is curl, an editor extension, or this —
  another program already running as you, which is the trust boundary the app
  has always had. The check it does *not* waive is the host one, so the client
  addresses the server as loopback.
- **Project scope.** The `x-project-dir` header, read fresh per request, because
  switching project is something you do while the app is open.
- **Bootstrap.** Probe `/api/system/health`; if nothing answers, start the built
  server detached and wait for it. Whatever it starts is left running on exit —
  quitting the terminal app should not stop the thing running your rituals.
- **State.** `cli/runStream.ts` folds run events into a `LiveRun` exactly as
  `useRuns` does in the browser, as a pure reducer so it can be tested against a
  recorded stream.

## Scope

### Ported

| Area | What you can do |
| --- | --- |
| Work | Sessions and runs as one list, in-flight vs history; start a session, open one, read the transcript, send a turn, answer prompts, run checks, read the diff, stop a run |
| Land | Pull requests with your name on them, grouped as asked-of-you vs yours; merge one, or start a session on one |
| Daily | What is scheduled, when it next fires, what it last did, whether the scheduler paused it; enable, disable, run now |
| Fleet | Mission control: spend and quota meters, tiles grouped by urgency, ticker, upcoming rituals; answer a permission prompt or stop a run from the tile |
| Inbox | What is waiting elsewhere, and refresh a source |
| Projects | Switch the active project, or cycle with `[` `]` from anywhere |

### Adapted, on purpose

- **Session shell** — drops you into a real `$SHELL` in the worktree rather than
  embedding a terminal emulator inside a terminal. The TUI suspends and resumes
  when you exit.
- **File editing** — opens `$EDITOR`. A young in-app editor is worth having in a
  browser, where there is no alternative. In a terminal there already is one.
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
- **Lists never wrap.** Two-line rows: a title and a reason to pick it.
  Titles truncate with `…`; metadata right-aligns in dim.
- **An inspector** for the selected row — beside the list when the terminal is
  wide, under it when it is not. A view that is only a list of names is a
  command palette.
- **Empty states are a sentence and the key that fixes it**, never a blank pane.
- **A braille spinner** for live work. No emoji anywhere.

### Work (home)

```
  agents-studio                         1 need you · ~/code/agents-ui · main
  1 Work  2 Land  3 Daily  4 Fleet  5 Inbox  6 Projects

  In flight  3     History  11

  ● Waiting for permission   Fix the flaky terminal test              2m
    feat/flaky-test · 4 files · 3 turns
  ◐ Working                  Port the wall to a new grid              now
    feat/wall-grid · 11 files
  ● Ready to land            Cache the pull request lookup           18m
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
  │ y once     a for this run     n deny                             │
  └──────────────────────────────────────────────────────────────────┘

  › _
  ⏎ send   esc back   d diff   c checks   x stop   s shell   o browser
```

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

| Key | Everywhere |
| --- | --- |
| `h` `l` | Previous / next view |
| `1`–`6` | Work · Land · Daily · Fleet · Inbox · Projects |
| `[` `]` | Previous / next project |
| `tab` | In-flight / history (on Work) |
| `?` | Keys |
| `r` | Refresh now |
| `o` | Open the current thing in the browser |
| `q` / `ctrl-c` | Quit |

| Key | In a list | | Key | In a session |
| --- | --- | --- | --- | --- |
| `↑↓` / `j` `k` | Move | | `i` | Write an instruction |
| `⏎` | Open | | `esc` | Back |
| `/` | Filter | | `d` | Diff |
| `n` | New session | | `c` | Run the checks |
| | | | `x` | Stop the run |
| | | | `s` | Shell in the worktree |
| | | | `y` `a` `n` | Answer a permission prompt |
| | | | `pgup/pgdn` `g` `G` | Scroll |

## Files

```
cli/
├── index.tsx          entry — arguments, connect, render
├── client.ts          HTTP and event streams              ✅
├── connect.ts         find the server, or start one       ✅
├── runStream.ts       run events → LiveRun (pure)         ✅
├── transcript.ts      session + run → drawable lines (pure)
├── format.ts          wrap, truncate, scroll, tone (pure) ✅
├── types.ts           the shapes the API returns          ✅
├── shell.ts           suspend for $SHELL, $EDITOR, browser
├── stubs/             build-time shim for Ink's devtools  ✅
└── ui/
    ├── App.tsx        views, global keys, layout
    ├── theme.ts       accent, glyphs, columns             ✅
    ├── hooks.ts       polling, actions, terminal size     ✅
    ├── components.tsx tabs, two-line rows, inspector, meters
    ├── WorkView.tsx · SessionDetailView.tsx · FleetView.tsx
    ├── RitualsView.tsx · LandView.tsx
    ├── InboxView.tsx · ProjectsView.tsx
scripts/build-cli.mjs  esbuild bundle                      ✅
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

Vitest, on the parts that are pure — which is where the bugs that matter live:

- `runStream` folded over a recorded event stream, including a replayed
  reconnect and a duplicated permission prompt.
- `transcript` — that a live run replaces its own recorded turn rather than
  appearing twice.
- `format` — wrapping a word longer than the pane, the scroll window at both
  ends, truncation.
- `connect` — port resolution from flags and the environment.

The rendering itself is checked by hand, plus a boot smoke test: Ink renders
once to a non-TTY, so `node .output/cli/index.mjs` proves it starts, connects
and draws without a terminal.

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

## Risks

- **Suspending Ink for a shell** is the fiddliest part: raw mode off, stdin
  paused, and a clean redraw afterwards. If it misbehaves it degrades to
  printing the worktree path, which is still useful.
- **Ink 5 with React 18** pins us behind current. Fine while the package
  supports Node 18; revisit when that floor moves.
- **Wide and combining characters** break naive column maths. Truncation is
  centralised in `format.ts` so there is one place to fix it if it shows up.
