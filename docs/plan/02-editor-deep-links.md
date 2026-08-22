# 02 · Open this worktree in an editor

**Wave** 3 · **Depends on** nothing · **Hot file** `app/pages/sessions/[id].vue`
**Done when** a session and a row in Workspaces on disk each offer an editor that opens
that worktree, and the choice is remembered.

## Why

There is no editor link anywhere in the tree. The workspace panes are deliberately young —
"for finishing, not living in" — which only works if leaving for a real editor is one press
rather than finding the path on disk yourself.

## Build

- A small util that builds the URL for VS Code (`vscode://file/<abs>`), Cursor
  (`cursor://file/<abs>`), Zed (`zed://file/<abs>`) and a plain "Reveal in Finder" via the
  existing shell path used elsewhere for opening things.
- Preferred editor in `server/utils/preferences.ts`, chosen once from a menu on the button,
  defaulting to VS Code.
- The button appears on the session header and on each row of `WorktreePanel.vue`.
- Absolute paths only, and percent-encode them. A worktree that no longer exists says so
  instead of opening nothing.

## Acceptance

- `make check` green, with tests for the URL builder including a path containing a space.
- By hand: the link opens the right folder in the chosen editor.

## Out of scope

Detecting which editors are installed. Opening a specific file or line.

## Findings

- **"The existing shell path used elsewhere for opening things" is in `cli/`, not
  the server.** `cli/shell.ts` has `openUrl`, but it is part of the terminal app and
  the server has no equivalent — nothing in `server/` opened a URL before this.
  `server/utils/editors.ts` therefore carries its own launcher, with the same three
  platform cases (`open` / `xdg-open` / `cmd /c start`), rather than reaching across
  the build boundary for eleven lines.
- **The press goes through the server rather than being an `href`.** Two reasons, both
  fatal to the link version: a browser will not navigate an `http` page to a `file`
  URL, so "Reveal in Finder" is not available to the page at all; and nothing in the
  browser can tell whether the directory is still there, so a worktree removed outside
  the app would give a button that appears to do nothing. `POST /api/editor/open`
  answers both, and `GET /api/editor` hands the page the list — the file manager's name
  is per-platform, which the browser has no business guessing.
- **Two encoding cases the obvious implementation gets wrong**, both caught by the
  tests before anything shipped: `encodeURI` leaves `#` and `?` alone, so a worktree
  called `issue#42` would truncate the URL and open its parent; and encoding a Windows
  path segment-by-segment turns `C:` into `C%3A`, which is not a drive to anything that
  reads these. Segments are encoded individually with the drive letter set aside.
- **`Preferences.editor` is stored but has no control on the Settings page**, which is
  what the brief asked for — the menu on the button is the only place it is chosen. If
  it ever wants one, the pattern is `effort`: a `USelect` and a one-line `saveEditor`.
- **The by-hand half of the acceptance was not done.** This ran unattended, and pressing
  the button launches an editor on somebody's machine. Everything up to the launch is
  covered instead: `test/editors.test.ts` for the URLs (including a path with a space,
  a `#`, and a drive letter) and `test/editorEndpoint.test.ts` for the wiring — a name
  from the menu is remembered, a later plain press uses it, and a worktree that is gone
  comes back as a sentence. Both endpoints are exercised only against paths that do not
  exist, so no test ever launches anything.
