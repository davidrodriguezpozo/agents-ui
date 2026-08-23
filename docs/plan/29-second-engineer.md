# 29 · A second engineer's first hour

**Wave** 9 · **Depends on** 16, 18 · **Hot files** setup wizard, README
**Done when** somebody whose team already uses this can go from a clone to a first session in
under an hour, following one path that assumes the team, not the solo case.

## Why

Everything in the team plane is worthless if joining is an afternoon of asking David. The
setup wizard exists and assumes a person starting alone; the interesting case now is a person
joining something already running.

## Build

- Read `app/components/SetupWizard.vue` and `TeamSetup.vue` before deciding what is missing.
- The path: clone, point at your own checkout, inherit the repository's shared rituals, checks
  and sandbox rules (brief 16), set your own spend cap, and start one session.
- What is *yours* and what is *the team's* must be obvious at each step — that distinction is
  the thing a new person gets wrong.
- The end of the wizard says what will now happen without them: which rituals fire, when, and
  where they will be told.

## Acceptance

- Have somebody actually do it, from a clone, without help, and write down every question
  they asked. Each one is either a fix or a `## Findings` line.
- `make check` green.

## Out of scope

Accounts, invitations, or anything that requires a service to exist.

## Findings

**A page, not an edit to the wizard.** `SetupWizard.vue` creates `~/.claude` on a
cold machine and `TeamSetup.vue` connects the team's marketplace and installs
plugins. Both are right about what they do, and neither is the path this brief
describes: tools are the first half of joining and the easy half. So `/join` is a
fifth-step path of its own, linked from the end of `TeamSetup` — where somebody
who has just installed their team's tools actually is — and from the palette.

**The whole page is one distinction, repeated five times.** Every step carries a
label: *yours* or *the team's*. That is the thing a new person gets wrong, and it
is expensive in both directions — thinking a shared ritual is yours means editing
it locally and wondering why the change never reaches anybody; thinking your spend
cap is shared means assuming somebody else set it and finding out on the invoice.
The labels are a tag rather than a sentence, because a sentence is skimmed.

**The last step is the one that did not exist anywhere.** "What will now happen
without you": the rituals actually switched on, when each next fires, and where
you will be told. A new person's real question is not how to set up — it is what
they have just signed up for. When nothing is on it says so in as many words, and
points at the step that changes it.

**Steps 2 and 3 are unit 16 seen from the other end.** The repository's shared
check command, sandbox rules and rituals, read out of
`.claude/agents-studio.json` and named as the team's — and the rituals arrive
*off*, so turning each one on is a decision made on this page rather than a
consequence of having pulled.

## Walked from a clean machine, and what it caught

An empty `CLAUDE_DIR`, a fresh clone carrying a committed
`.claude/agents-studio.json` — a check command, a sandbox rule and one ritual —
and the app started against it. The path worked end to end: step 1 recorded the
checkout, step 2 read all three shared things and named the file they came from,
step 3 listed *Nightly brief · Weekdays at 08:00* with a button, step 4 saved a
cap this machine only, and the summary flipped from "**Nothing.** No ritual on
this machine is switched on" to naming the ritual and its next run.

Two copy bugs, both found by watching rather than reading:

1. **"1 hosts."** Pluralisation on the sandbox line.
2. **"next just now"** for a run due the following morning. `relativeTime` is
   built for things that have happened, and on the one line of this page that is
   supposed to say what happens *next* it was worse than useless. It now renders
   an absolute local time — "next Mon 08:00".

**Also worth recording, because it cost me twenty minutes and would cost anybody
else the same:** driving this page from a script looked like a bug in the page
twice over. A synthetic `click()` on the button does nothing while the model is
still empty — `:disabled` is honoured — and a real click into the field followed
by typed keys never reached the input at all, so the button stayed disabled.
Setting the value through the native setter and dispatching `input` works. The
page was correct throughout.

## The acceptance I could not perform

The brief is explicit: *have somebody actually do it, from a clone, without help,
and write down every question they asked. Each one is either a fix or a `##
Findings` line.* I am not a second engineer, and no second person has walked this.
Everything above is a walk-through by the person who wrote it, which is precisely
the reader the brief excludes — I cannot be surprised by my own labels.

So this unit is **done as far as one person can take it** and the acceptance is
outstanding. The two questions I would expect first, and could not answer for
somebody else:

- *Where do I get the clone path from?* Step 1 wants an absolute path typed in,
  with no browse button and no `git clone` help. Somebody who has not cloned yet
  has nothing to paste.
- *Do I need the team's marketplace first, or the clone?* Both entry points exist
  and nothing says which order, because in truth either works — but "either
  works" is not what somebody joining wants to be told.

Both are small. Neither should be guessed at from this side of the desk.
