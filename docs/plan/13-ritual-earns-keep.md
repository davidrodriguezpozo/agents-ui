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

## Findings

- **"Ever landed" is only as long as the window.** The default for `expects` is read off
  the landings inside the window the figures cover — thirty days. A ritual whose last
  landing was five weeks ago therefore reads as one that reports until somebody says
  otherwise in Edit, which is the conservative way round: the cost of guessing "reports"
  is a briefing nobody nags, and the cost of guessing "code" is the page calling that
  briefing a waste of money. Making the default durable would mean either writing to
  `schedules.json` from a GET or a landing record that names the ritual that produced it;
  neither was in the brief.
- **A ritual only gets credit for a landing when its runs carry a `sessionId`.**
  `joinOutcomes` attributes a landing to the group of the last costed turn of the session
  that landed, and a plain scheduled run has no session. So a ritual that works by
  starting a session is attributable and one that commits directly is not — the second
  reads as zero landings and defaults to "reports". Worth knowing before anyone reads a
  zero as an accusation. Fixing it means recording the ritual on the landing, which is
  unit 11's record, not this one.
- **`summarize` in `runStore.ts` is now exported as `summarizeRun`.** The value endpoint
  needs both the cost of a run and how its firing ended, and reading the log twice to get
  them is the expensive half of the request. Exported under the old name it collided with
  `history.ts`'s `summarize` in the server auto-import namespace, which Nuxt resolves
  silently in favour of one of them.
- **The by-hand acceptance was done in a test, not by hand.** This session cannot start a
  server or run `node` directly, so "the morning brief must not be reported as worthless"
  is covered by `test/ritualValueEndpoint.test.ts`, which seeds a real store with a
  briefing ritual and asserts the sentence its row gets. The page itself is covered as far
  as `nuxt typecheck` and the production build cover a template.
- **Thresholds, since they are judgements.** Three firings before there is any verdict, for
  the reason `GIVE_UP_AFTER` is three. Five dollars before "nothing landed" is said in the
  warning colour rather than as a plain fact.
- **The window is fixed at thirty days on this page.** `/api/schedules/value` takes `?days`,
  but the row does not offer a picker: a ritual runs once a morning, so a week is five
  firings and no answer. Choosing windows is what the Work page's ledger is for.
