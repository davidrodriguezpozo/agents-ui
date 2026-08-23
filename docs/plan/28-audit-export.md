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

## Findings

**JSON Lines, `application/x-ndjson`, and one `GET`.** `/api/audit?days=` with a
`Content-Disposition`, so it is both a button and something `curl` can fetch — a
governance record you can only obtain by clicking is a record somebody ends up
screenshotting. The window is the only parameter: an export with options is an
export two people can produce differently and then argue about.

**The header declares what is left out, and now also counts what is absent.**
Four exclusions with a reason each — the prompt, the output, the transcript, and
file contents — because a reader who finds one silent omission stops believing
the rest of the file. What the first draft did not do was quantify the *absences*,
and that is the thing a sceptic notices first. See below.

**Transcripts are referenced.** The header says where they are on this disk. A
single file containing every conversation is the file that leaks, and nobody asked
for it.

**Absent is `null`, never zero.** A run with no cost recorded was not free; a run
from before identity existed has nobody rather than an unknown somebody. Both are
tested, because both are the kind of thing a later convenience would quietly turn
into a number.

## Exporting a real week, and what reading it as a sceptic changed

204 runs and 10 merges from this machine, over seven days. It worked first time —
including the line the brief says the file exists for:

```json
{"type":"merge","sessionId":"mt05zfi6sgww","route":"merged","checks":"failing","override":true,…}
```

One `grep '"override":true'` finds every merge that went in over a red check.
No prompt or output text appears anywhere in the file, asserted rather than
assumed.

Then reading it as somebody who does not trust it produced four changes:

1. **201 of 204 runs had `"who": null`** and the file said nothing about why.
   True — identity landed yesterday and almost every record predates it — but "the
   reason is real" is not something a reader can check. The header now carries a
   `nulls` block counting runs without a person, a model or a cost, and merges
   without a person or a commit, with a note saying what a null means. The file
   does the noticing.
2. **`"model": null` on a run that cost $3.64.** Explicable and indefensible
   as-presented: it now appears in that count, so it reads as a known gap rather
   than a hole.
3. **`"repo"` was a worktree path** for every session run, so a reader grepping
   for a repository would miss all 197 of them. The line now carries both `repo`
   (the repository, through `repositoryRootOf`) and `workspace` (where it actually
   ran).
4. **One run's source was `"unknown"`.** It was a command somebody invoked.
   `unknown` is the one word an audit file must not use about a thing that
   happened, so `command` is now its own source.

**What the file still undercounts, and says so in prose rather than in a field.**
`files` is read off `Write`/`Edit`/`MultiEdit`/`NotebookEdit` tool calls, so a run
that patched a file through `Bash` shows no files at all — a shell line that edits
is indistinguishable here from one that runs the tests. That is the honest
direction for an audit record to err in, and it is written at the top of
`filesTouched`. Making it exact would mean diffing the worktree per run, which is
a different brief.

**Not verified: the browser download.** The button is a link to the endpoint with
`download`, and the endpoint was exercised directly against real data. What was
not done is clicking it in a browser and confirming the file lands in Downloads
with the right name.
