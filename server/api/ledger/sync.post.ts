import { collectLocalLedger } from '../../utils/ledgerCollect'
import { syncLedger } from '../../utils/ledgerSync'
import { normaliseProjectPath, readProjects } from '../../utils/projects'
import { machineId, machineSlug, readLedgerFiles, teamLedger } from '../../utils/sharedLedger'

/**
 * Push this machine's file, pull everybody else's, and answer with the result.
 *
 * The repository is named by the caller and then checked against the projects
 * this app already knows, which is the only reason this endpoint is safe to
 * have: without that check it would run git in any directory a browser cared to
 * name. A path that is not a registered project is refused rather than added,
 * because adding one is a decision that belongs on the projects page.
 *
 * The whole of the sync is best-effort by design — see `ledgerSync.ts` for why
 * an unreachable remote is a return value and not an error — so this answers
 * 200 with what happened rather than failing. `push.skip` and `pull.skip` are
 * the two fields worth rendering.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ repoDir?: string }>(event).catch(() => ({} as { repoDir?: string }))
  const asked = normaliseProjectPath(body.repoDir ?? '')

  if (!asked) {
    throw createError({
      statusCode: 400,
      data: { error: 'no_repo', message: 'Name the repository to sync the ledger through.' },
    })
  }

  const projects = await readProjects()
  const project = projects.find(candidate => candidate.path === asked)

  if (!project) {
    throw createError({
      statusCode: 400,
      data: {
        error: 'unknown_repo',
        message: `${asked} is not one of your projects. Add it on the projects page first.`,
      },
    })
  }

  const now = Date.now()
  const collected = await collectLocalLedger(now)
  const { push, pull } = await syncLedger({ repoDir: project.path })

  const files = await readLedgerFiles()

  return {
    push,
    pull,
    collected,
    repoDir: project.path,
    machine: machineSlug(await machineId()),
    ...teamLedger(files, now - 30 * 86_400_000),
  }
})
