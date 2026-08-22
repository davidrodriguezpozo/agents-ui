# 28 · The audit export

**Wave** 9 · **Depends on** 11, 17 · **Hot files** a new export util + a button
**Done when** one file can be produced covering a window: every run, what it cost, what it
touched, what the sandbox allowed and refused, and every merge that went in with checks red
and who took it.

## Why

Agent HQ's pitch to a company is governance, and a self-hosting team currently has none of
that story. This turns local-first from the weakness in that conversation into the argument:
nothing left the building, and here is the record.

## Build

- One file, a documented format, machine-readable and greppable. JSON Lines over anything
  clever.
- Per run: id, when, who, source (session, ritual, workflow, chat), model, cost, duration,
  outcome, files touched, hosts allowed and refused, tools denied. Per merge: session, route,
  checks verdict, override and by whom.
- Transcripts are referenced, not embedded, and the export says where they are. A single file
  with every conversation in it is a liability nobody asked for.
- Redact nothing silently. If something is deliberately excluded, the file says which field
  and why, in a header line.

## Acceptance

- `make check` green, with tests for: an empty window, a run with no cost recorded, a merge
  with an override, a run from before identity existed.
- By hand: export a week and read it. Anything you cannot explain to a sceptical reader is a bug.

## Out of scope

Signing, encrypting, or uploading it. PDF. Anything pretty.
