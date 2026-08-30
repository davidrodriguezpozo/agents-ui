# 38 · The ten minutes that open the door

**Wave** 0 · **Who** David, by hand, once · **Not a session.**
**Done when** somebody arriving at the repository is told what it is now, rather than what it
was in March.

## Why

There is no telemetry here and there never will be, so the only thing that can ever say what
to build next is what people say. Measured on 29 August: **14 stars, 84 views and 14 unique
visitors in a fortnight, and a pinned roadmap issue with zero comments and zero reactions.**
Nobody is arriving, so nothing is being learned.

Every blocking item on `docs/launch/CHECKLIST.md` is ticked. These are the ten-minute ones
below the line, and each is a decision only the author can make — which is why this is a
by-hand unit and not a brief.

## The list

1. **The repository description is still March's**: *"UI to manage Claude Code agents,
   skills, commands…"*. Two audience revisions out of date. The replacement sentence and the
   `gh repo edit` command are already written in `docs/launch/CHECKLIST.md`.
2. **No topics at all** — `repositoryTopics` is null. The command is in the same file.
3. **The social preview has never been uploaded.** `docs/images/social-preview.png` is in the
   repository; GitHub is serving the default grey box, so every link posted anywhere renders
   as one. Repository → Settings → Social preview.
4. **Discussions are disabled**, and the issue-template config links to them.
5. **The pinned roadmap issue is wrong about the most interesting thing here.** It says
   *"Non-Claude model backends — not planned … a provider abstraction would be a different
   project."* Units 31 and 32 shipped exactly that, and unit 35 turns it into the sentence
   worth arriving for: **the rate limit stops ending your day.** Regenerate the issue from
   `docs/launch/roadmap-issue.md` after correcting that section.
6. **Three `good first issue`s**, which the census wrote for free: the model on the run (37),
   the ritual with a duplicate name, a gigabyte figure on one panel.

## The one judgement call

The pitch in the drafts leads with parallel sessions on worktrees, which has been `claude -w`
since February. It needs replacing before anything is posted, and the honest version has two
halves: **what happens after a run when nobody is watching** — your tests gate the merge, a
verdict expires when the base moves, several branches land in an order that accounts for each
other, a spend cap skips the work rather than billing you — and **it is not tied to one
vendor's agent.**
