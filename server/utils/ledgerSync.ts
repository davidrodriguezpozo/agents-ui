import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ledgerDir, ledgerFileName, machineId } from './sharedLedger'

const exec = promisify(execFile)

/**
 * Carrying the ledger between machines, using the repository as the post.
 *
 * `sharedLedger.ts` gets as far as a file per instance and no further. The
 * remaining question is transport, and every ordinary answer to it — a service
 * to post to, a bucket, a database somebody hosts — makes this app need an
 * account and a server it does not otherwise need, for the sake of appending a
 * few hundred bytes a day. The team already shares exactly one thing that
 * synchronises reliably, has authentication somebody else maintains, and is on
 * every one of their machines: the repository.
 *
 * So the ledger lives on a branch of it. One file per instance, and because no
 * two instances write the same file, a merge here is a concatenation with
 * nothing to resolve — which is why this never has to force, and never does.
 *
 * Two things about how it is written are deliberate:
 *
 *   - **The working tree is never touched.** No checkout, no stash, no branch
 *     switch. A blob is hashed straight into the object database, a tree is
 *     built in a throwaway index, and a commit is made from it with
 *     `commit-tree` — so this can run while somebody is mid-edit on a session
 *     in that repository, which, since it runs on a timer, it will be.
 *   - **A rejected push is retried once, and then left alone.** Rejection means
 *     a colleague pushed between the fetch and the push, and the fix is to
 *     rebuild on their tip and try again — the same concatenation, one commit
 *     later. If it happens twice, something is wrong that retrying will not
 *     fix, and there is no hurry: the lines are already safe locally and the
 *     next sync will carry them.
 *
 * Failure is a return value, not an exception. A machine with no network, a
 * repository with no remote, a branch nobody has pushed yet — all three are
 * ordinary and none of them is an error worth interrupting anybody over.
 */

/**
 * The branch, namespaced so it reads as machinery on sight.
 *
 * Session branches deliberately stopped being namespaced — see
 * `LEGACY_BRANCH_PREFIX` in `worktrees.ts` — because they are ordinary branches
 * somebody pushes and reviews. This one is the opposite: nobody opens a pull
 * request from it, nothing is ever reviewed on it, and a person who finds it in
 * `git branch -r` should be able to tell that at a glance.
 */
export const LEDGER_BRANCH = 'agents-studio/ledger'

/** Where the files sit inside that branch. */
const LEDGER_TREE = 'ledger'

export interface LedgerRemote {
  /** A repository the team shares. */
  repoDir: string
  remote?: string
  branch?: string
}

/** Why a sync did nothing. Each of these is ordinary. */
export type LedgerSyncSkip =
  /** The repository has no remote by that name. */
  | 'no-remote'
  /** Nobody has pushed the branch yet — the first push makes it. */
  | 'no-branch'
  /** The remote could not be reached. */
  | 'unreachable'
  /** Everything here is already there. */
  | 'up-to-date'
  /** Two rejections in a row. Left for the next sync. */
  | 'rejected'
  /** This instance has written nothing yet. */
  | 'nothing-to-push'

export interface LedgerPushResult {
  pushed: boolean
  /** The commit made, when one was. */
  commit?: string
  skip?: LedgerSyncSkip
  branch: string
  machine: string
}

export interface LedgerPullResult {
  /** Files brought in, by machine. This instance's own file is never one. */
  machines: string[]
  skip?: LedgerSyncSkip
  branch: string
}

async function git(repoDir: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd: repoDir,
    timeout: 60_000,
    env: env ? { ...process.env, ...env } : process.env,
  })

  return stdout.trim()
}

/** Whether the remote exists at all, which is cheap and local. */
async function hasRemote(repoDir: string, remote: string): Promise<boolean> {
  try {
    const remotes = await git(repoDir, ['remote'])
    return remotes.split('\n').map(line => line.trim()).includes(remote)
  } catch {
    return false
  }
}

/**
 * The branch as the remote currently has it.
 *
 * `ls-remote` first, so "nobody has pushed this yet" is told apart from "the
 * network is down" — the first is the normal state of a team's first day and
 * must not be reported as a failure.
 */
async function remoteTip(
  repoDir: string,
  remote: string,
  branch: string,
): Promise<{ sha?: string; skip?: LedgerSyncSkip }> {
  let listed: string
  try {
    listed = await git(repoDir, ['ls-remote', '--heads', remote, branch])
  } catch {
    return { skip: 'unreachable' }
  }

  if (!listed) return { skip: 'no-branch' }

  try {
    await git(repoDir, ['fetch', '--quiet', remote, `${branch}:refs/remotes/${remote}/${branch}`, '--force'])
  } catch {
    return { skip: 'unreachable' }
  }

  const sha = listed.split(/\s+/)[0]

  return sha ? { sha } : { skip: 'no-branch' }
}

/**
 * A commit carrying this machine's file, built without a checkout.
 *
 * The index is a temporary file the caller deletes: `read-tree` needs somewhere
 * to put the tree it reads, and the repository's own index belongs to whoever
 * is working in it.
 */
async function commitOurFile(
  repoDir: string,
  parent: string | undefined,
  path: string,
  entryPath: string,
  machine: string,
): Promise<{ commit: string; tree: string }> {
  const indexDir = await mkdtemp(join(tmpdir(), 'agents-studio-ledger-'))
  const env = { GIT_INDEX_FILE: join(indexDir, 'index') }

  try {
    if (parent) await git(repoDir, ['read-tree', parent], env)

    const blob = await git(repoDir, ['hash-object', '-w', '--', path])
    await git(repoDir, ['update-index', '--add', '--cacheinfo', `100644,${blob},${entryPath}`], env)
    const tree = await git(repoDir, ['write-tree'], env)

    const args = ['commit-tree', tree, '-m', `ledger: ${machine}`]
    if (parent) args.push('-p', parent)

    return { commit: await git(repoDir, args), tree }
  } finally {
    await rm(indexDir, { recursive: true, force: true })
  }
}

/** The tree a commit points at, for deciding whether anything changed. */
async function treeOf(repoDir: string, commit: string): Promise<string | undefined> {
  try {
    return await git(repoDir, ['rev-parse', `${commit}^{tree}`])
  } catch {
    return undefined
  }
}

/**
 * Push this machine's file, and only this machine's file.
 *
 * Nothing else in the tree is touched, which is what makes the merge trivial:
 * the commit made here is the colleague's tip with one blob replaced.
 */
export async function pushLedger(options: LedgerRemote): Promise<LedgerPushResult> {
  const remote = options.remote ?? 'origin'
  const branch = options.branch ?? LEDGER_BRANCH
  const machine = await machineId()
  const result: LedgerPushResult = { pushed: false, branch, machine }

  const path = join(ledgerDir(), ledgerFileName(machine))
  const entryPath = `${LEDGER_TREE}/${ledgerFileName(machine)}`

  // A push of a file that does not exist would be a commit deleting it.
  if (!existsSync(path)) return { ...result, skip: 'nothing-to-push' }

  if (!(await hasRemote(options.repoDir, remote))) return { ...result, skip: 'no-remote' }

  for (let attempt = 0; attempt < 2; attempt++) {
    const tip = await remoteTip(options.repoDir, remote, branch)
    if (tip.skip === 'unreachable') return { ...result, skip: 'unreachable' }

    const parent = tip.sha
    const { commit, tree } = await commitOurFile(options.repoDir, parent, path, entryPath, machine)

    // An identical tree means the file on the branch is already this file. A
    // commit saying so would be a commit whose only content is the date.
    if (parent && (await treeOf(options.repoDir, parent)) === tree) {
      return { ...result, skip: 'up-to-date' }
    }

    try {
      await git(options.repoDir, ['push', remote, `${commit}:refs/heads/${branch}`])
      return { ...result, pushed: true, commit }
    } catch {
      // Rejected, almost certainly because somebody pushed in between. Round
      // two rebuilds on their tip; a second rejection waits for the next sync.
    }
  }

  return { ...result, skip: 'rejected' }
}

/**
 * Bring every other machine's file into the store.
 *
 * Read out of the object database and written into the store, rather than
 * checked out: this repository's working tree may well have somebody's session
 * in it, and the ledger is not part of anybody's work.
 *
 * This machine's own file is never overwritten. The copy on the branch is at
 * best identical to it and at worst behind — it cannot be ahead, since nothing
 * else writes it — so taking it back would only risk dropping lines appended
 * since the last push.
 */
export async function pullLedger(options: LedgerRemote): Promise<LedgerPullResult> {
  const remote = options.remote ?? 'origin'
  const branch = options.branch ?? LEDGER_BRANCH
  const result: LedgerPullResult = { machines: [], branch }

  if (!(await hasRemote(options.repoDir, remote))) return { ...result, skip: 'no-remote' }

  const tip = await remoteTip(options.repoDir, remote, branch)
  if (tip.skip) return { ...result, skip: tip.skip }

  const ours = ledgerFileName(await machineId())
  const dir = ledgerDir()

  let listed: string
  try {
    listed = await git(options.repoDir, ['ls-tree', '-r', '--name-only', tip.sha!, '--', `${LEDGER_TREE}/`])
  } catch {
    return { ...result, skip: 'no-branch' }
  }

  const names = listed
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.endsWith('.jsonl'))
    .map(line => line.slice(`${LEDGER_TREE}/`.length))
    .filter(name => name && name !== ours)

  if (!names.length) return result

  await mkdir(dir, { recursive: true })

  for (const name of names) {
    try {
      const { stdout } = await exec('git', ['cat-file', 'blob', `${tip.sha}:${LEDGER_TREE}/${name}`], {
        cwd: options.repoDir,
        timeout: 60_000,
        // A ledger file is lines of JSON and stays small, but the default here
        // is 1 MB and a year of a busy machine will pass it.
        maxBuffer: 64 * 1024 * 1024,
      })

      await writeFile(join(dir, name), stdout, 'utf8')
      result.machines.push(name.slice(0, -'.jsonl'.length))
    } catch {
      // One unreadable file is one machine missing from the totals, which the
      // page already has a way of saying.
    }
  }

  return result
}

/** Both halves, in the order that makes the local store complete: ours out, theirs in. */
export async function syncLedger(options: LedgerRemote): Promise<{
  push: LedgerPushResult
  pull: LedgerPullResult
}> {
  const push = await pushLedger(options)
  const pull = await pullLedger(options)

  return { push, pull }
}
