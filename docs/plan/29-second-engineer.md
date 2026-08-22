# 29 · A second engineer's first hour

**Wave** 9 · **Depends on** 16, 18 · **Hot files** setup wizard, README
**Done when** somebody whose team already uses this can go from a clone to a first session in
under an hour, following one path that assumes the team, not the solo case.

## Why

Everything in the team plane is worthless if joining is an afternoon of asking David. The
setup wizard exists and assumes a person starting alone; the interesting case now is a person
joining something already running.

## Build

- Read `app/components/SetupWizard.vue` and `TeamSetup.vue` before deciding what is missing.
- The path: clone, point at your own checkout, inherit the repository's shared rituals, checks
  and sandbox rules (brief 16), set your own spend cap, and start one session.
- What is *yours* and what is *the team's* must be obvious at each step — that distinction is
  the thing a new person gets wrong.
- The end of the wizard says what will now happen without them: which rituals fire, when, and
  where they will be told.

## Acceptance

- Have somebody actually do it, from a clone, without help, and write down every question
  they asked. Each one is either a fix or a `## Findings` line.
- `make check` green.

## Out of scope

Accounts, invitations, or anything that requires a service to exist.
