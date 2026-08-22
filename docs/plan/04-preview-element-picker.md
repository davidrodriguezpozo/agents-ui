# 04 · Point at the thing in Preview

**Wave** 4 · **Depends on** nothing · **Hot files** `app/components/PreviewPane.vue`, `app/pages/sessions/[id].vue`
**Done when** clicking an element in the running preview, typing a note and pressing once
starts a turn that names the element's selector and the note.

## Why

The dev server is already in the page on its own port. What is missing is the interaction
that sends UI work to Cursor instead: point at the thing that is wrong, say what is wrong,
let the agent find it in the source.

## Build

- Read `app/components/PreviewPane.vue` and `server/utils/preview.ts` first, including how
  the port is handed over.
- A **Point** mode: hover highlights, click captures a CSS selector, the visible text, and
  the element's box. Injected into the previewed page — it is the project's own dev server,
  so a small injected script is fair game; document how it is injected in the file's comment.
- Several notes before sending, listed like the diff notes in brief 01, and composed the
  same way: selector, then text.
- A cross-origin or non-responding preview says the picker is unavailable and why. Never
  a blank overlay.

## Acceptance

- `make check` green, with tests for the selector builder (id, class, nth-child fallback)
  and for the composer.
- By hand: point at a button in this app's own preview, note "wrong colour", one press, the
  turn's instruction is actionable without the screenshot.

## Out of scope

Screenshots and drawing on them. Driving the page (clicks, form fills) on the agent's behalf.
