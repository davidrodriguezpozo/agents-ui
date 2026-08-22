# 09 · One comment back, and nothing else

**Wave** 5 · **Depends on** 07 · **Hot files** `app/pages/land.vue`, landing utils
**Done when** a session started from an issue posts exactly one comment on that issue when
it opens a pull request, naming the PR, and can post nothing else.

## Why

The person who filed the issue needs to know something happened, and they should not have
to be told by you in Slack. This is also the narrowest possible write: one comment, one
moment, composed here.

## Build

- Follow the Slack rule already in the app: **composed here, sent verbatim, denied every
  other way of writing**. The run that posts it holds one tool and no more.
- Trigger: the session's first pull request, once. Never on a later push, never twice.
- Text: what was done in one sentence (`server/utils/sessionSummary.ts` already writes it),
  the PR link, and that a person has not reviewed it yet.
- Off by default, with a setting, because a wrong comment on somebody else's issue is the
  kind of mistake that gets a tool banned.

## Acceptance

- `make check` green, with tests proving: one comment per session per issue, no comment when
  the setting is off, no comment when the PR already links the issue.
- By hand: on a throwaway issue in this repo.

## Out of scope

Replying to comments. Reacting. Closing. Any write to Notion.
