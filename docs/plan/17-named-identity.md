# 17 · Who did this

**Wave** 6 · **Depends on** 11 · **Hot files** run and session records, merge path
**Done when** every run and every merge records a person, and the ledger can group by them.

## Why

The moment more than one person runs this, "who merged with checks red" and "whose rituals
cost that" become the two questions worth answering. The merge commit already records an
override; nothing records who took it.

## Build

- Identity is git's: `user.name` and `user.email` from the repository, resolved once per run
  and stored on the record. **No accounts, no login, no new store for people.**
- Stamp: who started a run, who sent each turn, who merged, who took *Merge anyway*.
- Existing records have no person. They must read as **unattributed**, never as you.
- Extend brief 11's util with a per-person grouping, and add one line to the ledger page.

## Acceptance

- `make check` green, with tests for: a record with no identity, a repository with no git
  identity configured, two identities on one session.
- By hand: the merge dialog's override note names the person in the commit message.

## Out of scope

Permissions, roles, or anything that gates an action on who you are. GitHub does that.
