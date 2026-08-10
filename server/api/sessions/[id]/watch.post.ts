import { existsSync } from 'node:fs'
import { findSession, patchSession } from '../../../utils/sessions'
import { MAX_FIX_ATTEMPTS, readPrStatus } from '../../../utils/prWatch'

/**
 * Follow this session's pull request, or stop following it.
 *
 * Two switches rather than one, because they are two different promises.
 * Watching fixes red CI, which pushes to a branch that is already yours and is
 * undone by resetting it. Landing merges, which other people can see and which
 * nothing here can take back — so it is asked for separately every time, and
 * turning watching on never turns it on by implication.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ watch?: boolean; land?: boolean }>(event) ?? {}

  const session = await findSession(id)
  if (!session) {
    throw createError({ statusCode: 404, message: `Session not found: ${id}` })
  }

  // Stopping is always allowed and never asks GitHub anything: the point of
  // pressing it is usually that something is wrong.
  if (body.watch === false) {
    if (!session.prWatch) return { prWatch: null }

    const stopped = await patchSession(id, {
      prWatch: {
        ...session.prWatch,
        state: 'stopped',
        reason: 'You stopped watching this pull request.',
        updatedAt: Date.now(),
      },
    })
    return { prWatch: stopped?.prWatch ?? null }
  }

  const cwd = existsSync(session.worktreePath)
    ? session.worktreePath
    : existsSync(session.repoDir) ? session.repoDir : null

  if (!cwd) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'workspace_missing',
        message: 'This session\'s workspace is no longer on disk, so its pull request cannot be read.',
      },
    })
  }

  // The number from the URL we recorded when it was opened, falling back to the
  // branch — which is what `gh` would resolve if you typed it, and covers a
  // pull request opened by hand rather than from here.
  const ref = session.prUrl?.match(/\/pull\/(\d+)/)?.[1] ?? session.branch

  const status = await readPrStatus(cwd, ref)
  if (!status) {
    throw createError({
      statusCode: 409,
      data: {
        error: 'no_pull_request',
        message: 'No pull request could be read for this session. Open one first, and check that `gh` is installed and signed in.',
      },
    })
  }

  if (status.state !== 'OPEN') {
    throw createError({
      statusCode: 409,
      data: {
        error: 'not_open',
        message: `#${status.number} is already ${status.state.toLowerCase()}, so there is nothing left to watch.`,
      },
    })
  }

  const now = Date.now()

  // A fresh watch starts a fresh count, for the same reason pressing **Fix it**
  // does: asking again is asking again, and inheriting a spent streak would
  // make the button do nothing.
  const updated = await patchSession(id, {
    prUrl: status.url,
    prWatch: {
      state: 'watching',
      number: status.number,
      url: status.url,
      land: body.land === true,
      attempts: 0,
      max: MAX_FIX_ATTEMPTS,
      startedAt: now,
      updatedAt: now,
    },
  })

  return { prWatch: updated?.prWatch ?? null }
})
