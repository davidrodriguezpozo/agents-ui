# 05 · Be an MCP server, not just a client

**Wave** 1 · **Depends on** nothing · **Hot files** new — `server/api/mcp/` and a util
**Done when** a Claude Code session with this server configured can start a session, read
the standing brief, and list what is blocked, and the tools are documented in the README.

## Why

`app/pages/mcp.vue` and `server/utils/mcp.ts` configure MCP servers *for* agents. The
inverse — the app as a tool an agent can use — is what makes every later phase scriptable,
including by the sessions building them. Superset shipped this and it is the cheapest
leverage in the plan.

## Build

- Read `server/utils/mcp.ts` and `server/middleware/sameOrigin.ts`. **The middleware refuses
  anything that did not come from this app**, which an MCP client is not: decide how a local
  client authenticates and write the reasoning into the file's comment. Prefer a token in
  `~/.claude/agents-ui`, readable only by the user, over widening the origin rule.
- Four read tools first: `brief` (the exact text a run receives), `blocked` (what needs a
  person), `sessions` (id, repo, branch, checks verdict, one-sentence summary), `spend_today`.
- One write tool: `start_session(repo, instruction)` — the existing
  `server/api/sessions/index.post.ts` path, nothing new.
- Loopback only. Refuse a request that did not arrive on the loopback interface, and say so.

## Acceptance

- `make check` green, with tests for the token check, the loopback check, and each tool's
  shape.
- By hand: add it to this repo's own `.mcp.json`, ask a session "what is blocked", get the
  same answer the sidebar gives.

## Out of scope

Writing anything besides starting a session. Remote access of any kind.

## Findings

- **The middleware does not refuse an MCP client.** The brief says it does; it does not.
  An MCP client over HTTP sends no `Origin` and no `Sec-Fetch-Site`, and its `Host` is
  `127.0.0.1:3000` — a literal address `isTrustedHostname` trusts. So `checkOrigin` waves
  it through exactly as it waves through `curl`, and `sameOrigin.ts` says out loud that
  this is intended: its boundary is "another program already running as you". Nothing had
  to be widened, which is the good news. The token is still worth having and the reasoning
  moved with it: this route is the app's write surface compressed into one line of JSON
  that anything able to open a socket can post, and `start_session` spends money against
  your repositories. Written up at the top of `server/utils/mcpAccess.ts`.
- **`.mcp.json` could not be committed.** Editing it needs an approval this session had
  nobody to ask — the file is treated as sensitive. The exact snippet is in the README
  instead, using `${AGENTS_STUDIO_MCP_TOKEN}` so a committed config carries no secret. Two
  minutes to add by hand.
- **One endpoint beyond the brief's five tools: `GET /api/mcp/token`.** The token is
  created lazily, which is a circle — the file does not exist until something asks for it,
  and nothing can ask without already knowing it. Loopback-only, no token of its own
  (requiring one closes the circle again), and it hands back a ready-made `.mcp.json`. It
  exposes nothing new: anything that can reach it can already read the file off disk.
- **`collectAttention` moved out of `api/attention.get.ts` into `utils/attention.ts`.** The
  brief's `blocked` tool has to give the same answer the sidebar gives, and two derivations
  of "what is blocked" would disagree within a week — the app has been bitten by exactly
  that before, when the badge said "3" over a screen that said nothing was waiting. The
  endpoint is now one line over the util.
- **A name collision worth knowing about.** `MAX_SESSIONS` already exists in
  `utils/brief.ts`, and Nitro auto-imports are flat: a second export of that name made the
  build warn and would have quietly changed the brief's session cap from 10 to 50 for any
  server file relying on the auto-import. Renamed `MAX_MCP_SESSIONS`.
- **The by-hand acceptance is half done.** `make check` is green, and the endpoint's own
  wiring — loopback refusal, token refusal, the parse error, the 202 for a notification —
  is covered by calling the handler with stubbed h3 helpers, plus a check that the built
  route's auto-imports all resolve in `.output`. What could not be done unattended is
  running the server and asking a real session "what is blocked": starting a background
  process needed an approval nobody was there to give. Worth ten minutes with the app
  running before this is trusted.

## Findings — a later pass

**Connecting it was a `curl`, which meant it was a feature for whoever wrote it.**
The token endpoint and the ready-made `.mcp.json` both worked exactly as
designed; the whole of the path was still "run a command, read the JSON it
prints, paste it into a file". Library → MCP now carries a panel with a button
that writes the entry into a chosen project's `.mcp.json` server-side —
`server/utils/mcpConnect.ts`, `POST /api/mcp/connect`.

**The awkward part is not the writing, it is that the entry carries a bearer
token and `.mcp.json` is usually tracked.** So a tracked file is **refused**
rather than written-then-warned — by the time a warning is read the token is in
the index — and an untracked one is written *and* added to `.git/info/exclude`,
the same per-clone mechanism that hides `.worktrees/`. A `git add .` afterwards
stages nothing, which is asserted in a test.

**Other servers survive.** A project's `.mcp.json` is usually the team's, listing
servers with nothing to do with this app; ours is one key and everything else is
copied through, including keys outside `mcpServers`. An unparseable file is left
alone rather than replaced.

**And the thing this pass actually uncovered: the documented `curl` never worked
on a development server.** `/api/mcp/token` proves loopback from the socket, and
behind Vite's dev proxy `socket.remoteAddress` is `null` — the probe returned
`{ remoteAddress: null, hasSocket: true, forwarded: "127.0.0.1" }`. So on a dev
server the endpoint always refused, and the first version of the panel dutifully
printed that refusal where its controls should have been.

Trusting `x-forwarded-for` would fix it and break the one guarantee the check
exists for, so it stands. Instead the panel no longer depends on it: the button
writes the file on the server, where the token already is, and the copy-by-hand
route says plainly why it is unavailable here and where the file is. Verified
both ways — refused and explained on a dev server, and the config inline with a
masked token on a freshly built one.
