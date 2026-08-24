import type { Session } from '~/composables/useSessions'
import type { WorkItem } from '~/utils/workList'

/**
 * Closing a session from the work rail.
 *
 * Apart from `workList.ts`, which is shared with the terminal client, and that is
 * the whole reason this file exists rather than three more exports over there.
 * `cli/shims/useSessions.ts` carries a deliberately narrow `Session` — only the
 * fields the shared utils actually read — and the decision below needs three it
 * does not have: the branch, the base branch, and how far ahead the worktree is.
 *
 * Widening the shim to satisfy a function the TUI never calls would be the wrong
 * direction: its rail has no close control, because removing a worktree is not
 * something to offer from a keypress in a terminal.
 */

/**
 * What closing a row from the rail will actually do.
 *
 * Closing used to be offered on merged sessions only, where it is unambiguous:
 * the commits are in the base branch, so removing the worktree and deleting the
 * branch loses nothing. It is offered on "Your turn" as well now, because that is
 * where the tidying-up actually piles up — a session you asked a question, read
 * the answer to, and have no further use for sits there indefinitely otherwise,
 * and the only way to be rid of it was a trip into the page.
 *
 * But that group is not unambiguous, and the difference is `git branch -D`:
 * `deleteBranch` force-deletes, which is right for work that has landed and is
 * destruction for work that has not. So this decides, per row, between the two
 * endings the close endpoint already offers:
 *
 *   - **Nothing committed here** — remove the worktree, delete the branch, forget
 *     the record. The full tidy-up, and nothing is lost because there was nothing.
 *   - **Commits that are not in the base** — remove the worktree and *keep the
 *     branch*, archiving the record so there is a trail back to it. The disk space
 *     goes, the work does not.
 *
 * Uncommitted changes are deliberately not handled here. The server refuses them
 * unless forced, which is the right place for it: a rail row is the wrong surface
 * to be talking anyone through discarding an agent's unsaved output, and the
 * refusal arrives as a toast that says so.
 */
export interface CloseIntent {
  /** Passed to the close endpoint. False means the branch goes with the worktree. */
  keepBranch: boolean
  /**
   * The whole truth, on hover.
   *
   * The button's own words stay "Close" and then "Remove?" whichever ending this
   * is, and that is deliberate: the workspace is removed in every case, which is
   * the part a person is deciding about, and the safety is in `keepBranch` rather
   * than in the label. A second confirm vocabulary would be inventing a word for
   * a distinction the code has already made — and "Archive" in particular is
   * taken, by the Move to History action that deletes nothing.
   */
  hint: string
}

export function closeIntent(item: WorkItem, session: Session): CloseIntent {
  const base = session.baseBranch
  const ahead = session.worktree?.ahead ?? 0

  // Merged: unchanged from when this was the only closable group.
  if (item.status === 'landed') {
    return {
      keepBranch: false,
      hint: `Removes ${session.worktreePath} and deletes the branch. `
        + `The commits are in ${base}.`,
    }
  }

  // Work that has not landed. Keeping the branch is the whole point: the row is
  // being tidied away, not thrown away.
  if (ahead > 0) {
    return {
      keepBranch: true,
      hint: `Removes ${session.worktreePath} and keeps the branch ${session.branch}, `
        + `which has ${ahead} commit${ahead === 1 ? '' : 's'} that ${ahead === 1 ? 'is' : 'are'} `
        + `not in ${base}. Nothing committed is lost.`,
    }
  }

  return {
    keepBranch: false,
    hint: `Removes ${session.worktreePath} and deletes the branch ${session.branch}. `
      + 'Nothing has been committed here.',
  }
}

/**
 * Whether a rail row can be closed from the rail at all.
 *
 * Runs cannot — there is no workspace to remove. Neither can a session whose turn
 * is still going or one waiting on a permission answer: both are mid-flight, and
 * "close" on something that is still moving means stopping it first, which is a
 * different decision and a different button.
 */
export function closableFromRail(item: WorkItem): boolean {
  return item.origin === 'session' && (item.status === 'landed' || item.status === 'yours')
}
