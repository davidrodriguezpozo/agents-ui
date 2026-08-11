# Screenshots

Captured from the demo environment (`node scripts/demo-data.mjs seed`), not from a
real machine — so nothing here is anyone's private config. Every number shown is
real: file counts, commit counts and the merge preview come from actual git state
in the demo repository.

The one exception is **check verdicts**, which are seeded rather than executed. A
worktree is a bare checkout with no `node_modules`, so really running the demo
project's suite would report "checks did not run" on every session — the single
state that says nothing about the code, and the one worth showing least. The
verdicts carry a real workspace fingerprint, so the app believes them exactly as
it would a run of its own.

The seeded night is shaped rather than sampled, for the same reason: the timeline
is only worth drawing if it has four lanes with blocks in them, outcomes that are
not all one colour, and two sessions that genuinely overlap. Everything it draws
— start times, durations, costs, which run needed a permission — comes from the
runs on disk.

Light mode at 1456×839 unless noted.

| File | What it shows |
| --- | --- |
| `01-sessions-list.jpg` | Parallel sessions, each on its own branch and worktree, with what each has produced — files changed, commits, uncommitted work, turns |
| `02-worktrees-on-disk.jpg` | Every worktree git actually knows about, so none accumulate unnoticed. Hidden from `git status` via `.git/info/exclude` |
| `03-session-conversation.jpg` | A session's conversation — headings, lists, code and tables rendered from the agent's markdown |
| `04-session-diff.jpg` | What the session changed, per file, before deciding whether to keep it |
| `05-session-merge.jpg` | Merge preview. States what will be brought across and into which branch, before touching the checkout |
| `06-daily-rituals.jpg` | Scheduled work, with recurrence, next run, and which came from a plugin rather than being written by hand |
| `07-ritual-needs-permission.jpg` | A ritual that hit a permission prompt with nobody there to answer. Offers the one narrow rule it needed rather than full access |
| `08-backups.jpg` | Automatic snapshots of sessions and rituals, stored outside the app's own directory so they survive it being deleted |
| `09-activity.jpg` | Every run — scheduled, agent and session turns — with cost, duration and outcome |
| `11-agents.jpg` | Subagents with their model tier and tool allowlists |
| `12-commands-by-origin.jpg` | Commands grouped by where they come from — personal, or a named plugin |
| `13-workflow-builder.jpg` | Chaining agents into a pipeline, each step resolved to its agent and model |
| `14-workspace-editor.jpg` | Editing a file in the session's own workspace — file tree, syntax colouring, line numbers, and "put it back" below |
| `15-workspace-preview.jpg` | The project's dev command running in the session's workspace, on a port of its own, shown in the page |
| `16-workspace-terminal.jpg` | A real shell in the session's workspace, on its branch — the git output is that worktree's actual state |
| `17-session-verdicts.jpg` | The four verdicts a row can carry — failed, passed-then-changed, passed, no changes — each with the sentence describing what the session did. Failing work sorts to the top |
| `18-merge-blocked-by-checks.jpg` | A merge refused because the session's checks fail. Names the command, shows the failure, and offers *Merge anyway* rather than no way through |
| `19-merge-train.jpg` | The order several finished sessions would land in, and which cannot land at all — with the reason on each |
| `20-dashboard-night.jpg` | The digest and the timeline together — what went wrong in sentences, above the same night drawn as a picture |
| `21-night-shift.jpg` | The last day per lane, overlapping runs stacked rather than drawn over each other, cumulative spend on its own axis, and every outcome carrying a glyph as well as a colour |
