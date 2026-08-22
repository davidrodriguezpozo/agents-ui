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

## What was built

One band, two sources. `server/utils/issues.ts` gained the composition (`readIntake`,
`composeIntake`, `notionHalf`, `ticketAsIssue`, `ticketDetail`, `ticketBranchName`,
`sessionOnTicket`, and a `source` on every row); `server/utils/notionIntake.ts` holds the
configuration, the store and the reply parsing; `server/utils/notionIntakeRefresh.ts` runs the
reading through the inbox's Notion MCP server with `INBOX_DENIED_TOOLS` and
`pickInboxServer`'s pre-flight. `POST /api/notion/refresh` is the only thing that ever asks
Notion. Settings gained **Tickets in Notion** — data source, status property, status value —
and Land gained a Notion note with the age and cost of the last reading and a **Read Notion**
button. Pressing any row goes through `server/api/github/issues/work.post.ts`, which now takes
a `key` (`github:42`, `notion:<page id>`) and builds both prompts with the same `issuePrompt`.

## Findings

- **`issuePrompt` is shared, not literally unchanged.** The containment is the same code —
  same `fenceFor`, same two markers, byte-identical output for a GitHub issue — but the
  provenance sentence, the heading and the "nothing goes back" line are now chosen by
  `issue.source`. Reusing it *verbatim* would have told a model that a Notion page was
  "quoted from GitHub" and offered it `gh issue view 0`, which is a lie in the one paragraph
  that has to be believed. Every GitHub assertion in `test/issues.test.ts` still passes
  untouched; the Notion path asserts the same fence and marker behaviour separately.
- **A ticket's text is not re-read at the moment of the press.** The GitHub half re-reads,
  because `gh issue view` is a second and free; re-reading a Notion page is another model run
  of tens of seconds. So a session is handed what the row was drawn from, and the prompt says
  the date it was read and links the page. This is the one place the two halves genuinely
  differ, and it is stated in the prompt rather than hidden.
- **The Notion half never claims a row is *yours*.** Working out which Notion person is "me"
  is most of what made a first inbox refresh cost $1.39, and it is not worth a model run to
  decide the wording of a badge — so `assignedToYou` is always false and a ticket is always an
  invitation. The consequence to know about: the band's "*n* on you" count never includes
  Notion rows, and Notion rows always sort below any GitHub issue that is on you.
- **Notion comments are not read.** The intake fetches a page's own text and nothing else, and
  the prompt says so rather than saying nobody has commented. Reading a page's discussion would
  roughly double what a reading costs for a thread this app has no other use for.
- **There is no scheduled reading.** `InboxSourceState` has a `refreshAt`, and this store
  deliberately does not: the inbox earned a daily job only once a refresh cost $0.38, and
  nothing here has been measured yet. Adding one is `dueForRefresh` plus a tick in
  `inboxTick.ts`, and it should wait until somebody has watched what a real reading of their
  own database costs.
- **The route and the composable kept their names.** `/api/github/issues` and
  `useGithubIssues` now carry both sources, which is a worse name than it was. They were not
  renamed because brief 09 is about to extend `server/api/github/issues/work.post.ts`, and
  moving that file now guarantees the one conflict `CONTRACT.md` names. The rows say which
  tracker they came from, which is the part that has to be honest; the file names are debt for
  whoever does 09 or later.
- **`Issue.number` is now `number | null`.** A Notion ticket has no number and was not given a
  synthetic one, because every number on this band is a number somebody eventually types. Rows
  carry `key` and `ref` instead, and `Session.ticketOf` is a sibling of `issueOf` rather than
  an overload of it.

## Acceptance not performed

`claude mcp list` cannot be run from this session and the Notion configuration cannot be set
without writing to `~/.claude/agents-ui`, so no real data source was read and no real ticket
was rendered. What is mechanised instead: the fixture payloads the brief asks for (a ticket
with the status, one without, one with no status at all, a body containing a triple-backtick
run, an empty body), the two refusals that happen before anything is spent, and the
reconciliation that matters — `composeIntake` keeps the GitHub half whole when the Notion half
carries `pickInboxServer`'s "not connected" refusal, and keeps the tickets when `gh` is the
half that is missing. **Unproven: that a real Notion database answers this prompt in the shape
`parseTicketReply` expects, and what one reading of it actually costs.** Somebody with the
Notion MCP server connected has to set the three fields in Settings and press **Read Notion**
once.
