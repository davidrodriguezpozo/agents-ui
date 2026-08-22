# 08 · Linear as a second source

**Wave** 4 · **Depends on** 06, 07 · **Hot files** new util + `app/pages/land.vue`
**Done when** Linear issues assigned to you, or carrying the agreed label, appear in the
same band and can become a session the same way.

## Why

Linear is the most strategically aimed competitor in the scan — it owns the moment work is
created, and it now runs coding sessions of its own in a managed sandbox. Consuming it beats
competing with it: a Linear-shaped ticket, executed on your machine, under your checks.

## Build

- Read brief 06's implementation first and extend it rather than forking it: one band, two
  sources, a badge saying which.
- Auth: an API key in Settings, stored the way other secrets in this app are stored — if
  nothing here stores a secret yet, say so under `## Findings` and use the narrowest thing
  that works. **Do not** invent an OAuth flow.
- Read-only. Issues assigned to the configured user, or labelled `studio`.
- Absent or invalid credentials: the band still renders its GitHub half and says Linear is
  not configured. Never an error page.

## Acceptance

- `make check` green, with tests over fixture Linear payloads and for the missing-credential
  path.
- By hand: with a key set, a Linear ticket appears and becomes a session.

## Out of scope

Writing to Linear. Projects, cycles, and anything that is not an issue.

## If blocked

No API key available is a `## Blocked`, not a reason to build a mock. Ship 06's band
unchanged and stop.
