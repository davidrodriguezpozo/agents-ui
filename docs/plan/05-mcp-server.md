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
