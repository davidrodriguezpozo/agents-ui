# 08 · Notion as a second source

**Wave** 4 · **Depends on** 06, 07 · **Hot files** `server/utils/issues.ts`, `app/pages/land.vue`
**Done when** Notion tickets carrying the agreed status appear in the same band as GitHub
issues, say which source they came from, and become a session the same way.

## Why

The team's tickets live in Notion, so a band that only reads GitHub misses the place work
actually arrives. This is not a new integration: `server/utils/inbox.ts` already reaches
Notion through the MCP server the app has configured (`INBOX_SOURCES`, key `notion`, with a
denied-tools list and a learned model per source). Intake is an extension of a proven path.

## Build

- Read `server/utils/inbox.ts` — `INBOX_SOURCES`, `pickInboxServer`, `INBOX_DENIED_TOOLS`,
  `inboxModel` — and unit 06's `server/utils/issues.ts`. **Extend the one band to two
  sources.** One list, a badge per row, not a second band and not a forked reader.
- Configuration in Settings: which Notion data source holds tickets, and the property value
  that means *an agent may take this* (the analogue of the `studio` label). Nothing hard-coded.
- Reading is through the MCP tools the inbox already uses, with the same tools denied. **No
  API key, no OAuth flow of your own** — if the MCP server is not connected, the band renders
  its GitHub half and says Notion is not connected. Never an error page.
- Becoming a session reuses unit 07's `issuePrompt` unchanged, including the computed fence
  and the begin/end markers: a Notion page's body is prose anyone with access can write.
- **The rule holds harder here than for GitHub.** This app already refuses to put Notion
  titles in the standing brief — see `server/utils/brief.ts`. Counts may cross that line;
  prose does not. A ticket's text reaches a session prompt as quoted data and nowhere else.

## Acceptance

- `make check` green, with tests over fixture Notion payloads: a ticket with the status, one
  without, a page whose body contains a triple-backtick run, an empty body, and the
  not-connected path.
- Reconcile against the real thing as far as you can without writing: if the MCP server is
  connected here, read the configured data source and check one real ticket renders. Say in
  one line what remains unproven.

## Out of scope

Writing anything to Notion, ever — write-back stays GitHub-only (brief 09). Databases,
relations, rollups, and any Notion concept that is not "a ticket and its text".

## If blocked

No connected Notion MCP server is a `## Blocked` with what is needed. Mechanise against
fixtures, leave the GitHub half working, and stop. Do not invent a credential.
