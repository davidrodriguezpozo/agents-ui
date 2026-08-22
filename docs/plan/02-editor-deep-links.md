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
