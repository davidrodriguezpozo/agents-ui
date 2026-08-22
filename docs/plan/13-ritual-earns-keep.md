# 13 · Does this ritual earn its keep

**Wave** 3 · **Depends on** 11 · **Hot files** `app/pages/schedules.vue`, ritual health utils
**Done when** each ritual row carries what it has cost and what it has produced over its
recent runs, and a ritual that has cost real money and landed nothing says so in words.

## Why

Ritual health already stops a schedule after three empty runs, which is the reliability
question. This is the *value* question, and it is the one that makes people delete things:
"forty-one euros in three weeks, nothing landed" is a different sentence from "failing", and
only one of them gets acted on.

## Build

- Read how the row currently expands into its recent outcomes, and add to that rather than
  building a second panel.
- Per ritual: spend over the window, runs, runs that came to nothing, landings attributable
  to it, and spend per landing where there is one.
- The verdict in one line, in the app's existing voice. A briefing ritual that never lands
  code is not failing — its output is a message, and the row must not call that worthless.
  Distinguish rituals that are expected to land from rituals that are expected to report;
  make that a property of the ritual, defaulting by whether it has ever landed anything.
- No new number in the row without a definition reachable from it.

## Acceptance

- `make check` green, with tests for the verdict over: a reporting ritual, a landing ritual
  that lands, a landing ritual that has not landed in three weeks, a ritual with two runs.
- By hand: the morning brief must not be reported as worthless.

## Out of scope

Turning a ritual off automatically on cost. Say it; let a person press it.
