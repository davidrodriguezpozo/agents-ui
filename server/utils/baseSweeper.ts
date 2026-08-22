import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import {
  conflictPrompt, conflictedFiles, planSweep,
  type SweepInput, type SweepPlan, type SweepResult,
} from './baseSweep'
import { hasLanded } from './lander'
import { mergedBranches } from './merge'
import { readSessions, type Session } from './sessions'
import { isTurnRunning, startTurn } from './sessionTurn'
import { verifySession } from './sessionChecks'
import {
  canonicalPath, diffBase, listWorktrees, updateFromBase, worktreeStatus,
  type UpdateFromBaseResult,
} from './worktrees'

const exec = promisify(execFile)

/**
 * The half of the base sweep that touches the disk.
 *
 * `baseSweep.ts` decides; this reads the state those decisions are made from and
 * carries them out. Split for the reason `landing.ts` and `lander.ts` are: the
 * decisions are the part worth testing against fixtures, and the part that must
 * not change depending on what a `git` call happened to answer.
 *
 * The four things it does that are worth pointing at are all in `sweepInputs`,
 * because they are what the plan is made of: how far behind each session is,
 * whether it is dirty, whether a turn is running in it, and whether anything
 * else on this machine has its branch checked out.
 */

/**
 * The operations the pass performs, injectable.
 *
 * Not for purity. Two of these are genuinely dangerous to call in a test — one
 * spawns an agent and the other runs a project's whole check suite — and a seam
 * here is what lets the interesting half be tested against real git repositories
 * without either of those happening.
 */
export interface SweepHooks {
  update(worktreePath: string, baseBranch: string): Promise<UpdateFromBaseResult>
  conflicts(worktreePath: string): Promise<string[]>
  recheck(sessionId: string): Promise<{ status: string } | null>
  askToResolve(session: Session, prompt: string): Promise<string>
}

export const REAL_HOOKS: SweepHooks = {
  update: updateFromBase,
  conflicts: async (worktreePath) => {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 15_000 })
      .catch(() => ({ stdout: '' }))
    return conflictedFiles(stdout)
  },
  recheck: async sessionId => verifySession(sessionId),
  askToResolve: async (session, prompt) => startTurn(session, prompt, { repair: true }),
}

/**
 * Everything the plan is decided from, read fresh.
 *
 * `heldElsewhere` is the one that needs saying: a branch checked out in two
 * places at once cannot be written to from one of them without moving it under
 * the other, and `gh pr checkout` in the main repository is how that happens by
 * accident. A session's *own* worktree holding its own branch is the normal case
 * and is not that.
 */
export async function sweepInputs(repoDir: string, baseBranch: string): Promise<SweepInput[]> {
  const sessions = (await readSessions()).filter(session => session.repoDir === repoDir)
  if (!sessions.length) return []

  const [merged, worktrees] = await Promise.all([
    mergedBranches(repoDir, baseBranch).catch(() => new Set<string>()),
    listWorktrees(repoDir).catch(() => []),
  ])

  /** Branch to every path holding it, so a second holder can be spotted. */
  const holders = new Map<string, string[]>()
  for (const worktree of worktrees) {
    if (!worktree.branch) continue
    holders.set(worktree.branch, [...(holders.get(worktree.branch) ?? []), worktree.path])
  }

  return Promise.all(sessions.map(async (session) => {
    const worktreeExists = Boolean(session.worktreePath) && existsSync(session.worktreePath)

    const status = worktreeExists
      ? await worktreeStatus(session.worktreePath, await diffBase(session), session.baseBranch)
      : { exists: false, ahead: 0, behind: 0, changedFiles: 0, dirty: false }

    /*
     * Compared canonical, because these two strings come from different places
     * and disagree about symlinks: `git worktree list` resolves them and a
     * session record holds what it was given. On macOS, where the temporary
     * directory and often the home directory are symlinks, that made every
     * session's *own* worktree look like a second checkout holding its branch —
     * and the pass then skipped every session in the repository, for a reason
     * that read as a sensible safety refusal.
     */
    const mine = worktreeExists ? await canonicalPath(session.worktreePath) : session.worktreePath
    const elsewhere = (await Promise.all(
      (holders.get(session.branch) ?? []).map(async path => ({ path, canonical: await canonicalPath(path) })),
    )).filter(held => held.canonical !== mine).map(held => held.path)

    return {
      id: session.id,
      title: session.title,
      status: session.status,
      branch: session.branch,
      baseBranch: session.baseBranch,
      repoDir: session.repoDir,
      worktreePath: session.worktreePath,
      detached: session.detached,
      inBase: hasLanded(session.branch, status.ahead, merged),
      landedAndHeld: Boolean(session.landed && !session.reverted),
      behind: status.behind,
      dirty: status.dirty,
      worktreeExists,
      busy: worktreeExists ? await isTurnRunning(session) : false,
      heldElsewhere: elsewhere[0],
    }
  }))
}

/** What the offer shows, and the same judgement the run makes. */
export async function planBaseSweep(repoDir: string, baseBranch: string): Promise<SweepPlan> {
  return planSweep(repoDir, baseBranch, await sweepInputs(repoDir, baseBranch))
}

/**
 * Bring the base into every session the plan says to, one at a time.
 *
 * Sequential rather than parallel, and that is not caution about git: a conflict
 * starts a turn, and starting five turns at once in five worktrees is five agents
 * competing for the same machine at the moment somebody is waiting to see whether
 * a merge worked.
 *
 * Nothing here throws. Each session's outcome is its own row, because the whole
 * point of a pass is that one awkward workspace does not stop the other four
 * from catching up.
 */
export async function runBaseSweep(
  repoDir: string,
  baseBranch: string,
  hooks: SweepHooks = REAL_HOOKS,
): Promise<{ plan: SweepPlan; results: SweepResult[] }> {
  const plan = await planBaseSweep(repoDir, baseBranch)
  const sessions = new Map((await readSessions()).map(session => [session.id, session]))
  const results: SweepResult[] = []

  for (const candidate of plan.candidates) {
    if (candidate.disposition !== 'update') continue

    const session = sessions.get(candidate.id)
    if (!session) continue

    const head = { id: candidate.id, title: candidate.title }

    let update: UpdateFromBaseResult
    try {
      update = await hooks.update(session.worktreePath, baseBranch)
    } catch (e: any) {
      results.push({ ...head, outcome: 'failed', message: e?.data?.message || e?.message || 'The update did not go through.' })
      continue
    }

    if (update.status === 'already-current') {
      results.push({ ...head, outcome: 'skipped', message: update.message })
      continue
    }

    if (update.status === 'refused') {
      results.push({ ...head, outcome: 'failed', message: update.message })
      continue
    }

    if (update.status === 'conflicted') {
      // Left where it is on purpose: the session needs both sides in front of
      // it, and a merge this app aborted is a conflict nobody can resolve.
      const conflicts = await hooks.conflicts(session.worktreePath).catch(() => [])

      try {
        const runId = await hooks.askToResolve(session, conflictPrompt(baseBranch, conflicts))
        results.push({
          ...head,
          outcome: 'conflicted',
          message: `${baseBranch} conflicts with this session's work. It has been asked to resolve it.`,
          runId,
          conflicts,
        })
      } catch (e: any) {
        // The conflict is still in the workspace and still resolvable by hand,
        // which is worth saying rather than reporting a clean failure.
        results.push({
          ...head,
          outcome: 'conflicted',
          message: `${baseBranch} conflicts with this session's work, and a turn could not be started: `
            + `${e?.data?.message || e?.message || 'unknown reason'}. The conflict is in the workspace.`,
          conflicts,
        })
      }
      continue
    }

    // Updated. The verdict it had was about code that is no longer what would
    // land, so it is re-run here rather than left looking green.
    try {
      const check = await hooks.recheck(candidate.id)
      const status = check?.status

      results.push({
        ...head,
        outcome: 'updated',
        message: `${update.message}${status ? ` Checks: ${status}.` : ''}`,
        ...(status === 'passing' || status === 'failing' || status === 'errored' ? { check: status } : {}),
      })
    } catch (e: any) {
      results.push({
        ...head,
        outcome: 'updated-unverified',
        message: `${update.message} The checks could not be re-run: ${e?.data?.message || e?.message || 'unknown reason'}.`,
      })
    }
  }

  return { plan, results }
}
