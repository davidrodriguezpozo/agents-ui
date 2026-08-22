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

## Findings

- **"Injected into the previewed page" needed a proxy, and that is most of the work.** The
  brief treats injection as a given, but the iframe pointed at `127.0.0.1:<devPort>` is a
  different origin from the app, so the app can neither reach into the document nor ask a
  dev server it did not write to serve an extra script. So `server/utils/previewProxy.ts` is
  a second local HTTP server per session that mirrors the dev server's whole path space at
  its own root and adds one `<script defer>` tag to HTML responses. Root rather than a route
  under this app on purpose: a project's `/_nuxt/entry.js` has to stay `/_nuxt/entry.js` or
  nothing loads. WebSocket upgrades are tunnelled raw so hot reload keeps working.
- **The iframe always goes through the proxy, not only in Point mode.** Switching the src
  when Point is pressed would reload the page and lose whatever route somebody had navigated
  to in order to point at something. The script is inert until the parent asks for Point
  mode. If the proxy will not start, the iframe falls back to the dev server directly and the
  picker says it is unavailable and why — the preview never breaks because of the picker.
- **The brief's "cross-origin" case became three states, not two.** Between the iframe's
  `load` and the picker saying hello there is a real window where the honest answer is "we do
  not know yet". So the button loads rather than sits dead, and after three seconds of saying
  hello the pane says the page did not answer and names the two reasons it would not.
- **`Content-Security-Policy` from the project is left alone.** Stripping it would make the
  script run on the few dev servers that set one, at the cost of changing the thing under
  review. A page whose CSP blocks the script reports the picker unavailable, which is true;
  the message names CSP so the reason is findable.
- **The selector rules are shipped by embedding the function's own source.**
  `server/utils/previewSelector.ts` is a plain, self-contained function, and
  `previewPicker.ts` puts it in the page with `Function.prototype.toString()`. That is why
  the file says, twice, that it must reference nothing outside itself: anything it closed
  over would be renamed by the server bundler and the injected copy would throw. The
  alternative was one copy tested and one copy shipped, which drift.
- **`:nth-child` is the fallback and only the fallback.** It is added when a sibling answers
  to the same tag and classes, which is decidable from the element alone. Shortening is the
  other half and needs the page: `selectorFor` takes a `count` callback —
  `document.querySelectorAll(sel).length` in the browser — and returns the shortest suffix
  that still matches one element. Without it the full path comes back, which is longer and
  never wrong.
- **Point notes live in the page, not in a store.** The diff notes are durable because
  reading a long diff gets interrupted and the notes outlive the diff. A note here is written
  against a preview running in front of you on a port that does not survive a reload, so
  outliving it would make it a note about somewhere else. `composePointNotes` therefore drops
  nothing: there is no equivalent of a line that has gone.
- **`PreviewPane` sends the turn itself.** It emits `sent` afterwards so the page can refresh
  the conversation and follow the run — the two things `sendReview` does — but the notes and
  the selectors never leave the component.
- **What remains unproven.** The by-hand line — point at a button, type "wrong colour", one
  press — needs a browser, so it is mechanised as far as this boundary goes:
  `test/preview.test.ts` starts a real dev server the real way and asserts the picker port
  serves that server's page with the script in it, `test/previewProxy.test.ts` drives the
  proxy over HTTP against a stand-in dev server, and `test/previewNotes.test.ts` takes the
  selector the picker would compute for a button through the composer and asserts the exact
  instruction. The hover highlight, the swallowed click and the `postMessage` handshake are
  browser behaviour and are unverified: somebody has to open a session, run the preview,
  press **Point** and click something.
