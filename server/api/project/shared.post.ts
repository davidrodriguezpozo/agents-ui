import { checkCommandFor, projectChecksStore } from '../../utils/checks'
import {
  normaliseSandbox, projectSandboxStore, sandboxForProject, type ProjectSandboxes,
} from '../../utils/sandbox'
import { getProjectDir } from '../../utils/scope'
import { updateSharedProject } from '../../utils/sharedProject'

/**
 * Share this machine's answer with the repository, or stop sharing it.
 *
 * Two things about this endpoint are the point of the feature rather than
 * details of it. It writes a file in the working tree and nothing else — no
 * commit, no push — so what happens next is somebody reading a diff and
 * deciding. And it copies *this machine's current answer* rather than taking
 * one from the request body: sharing is "make what I have the team's default",
 * which is a sentence a person can check against what they are looking at.
 *
 * Sharing does not clear the local answer. The machine keeps overriding the
 * repository — see `scoped` — so the value in force does not change at the
 * moment of sharing, which is what makes the button safe to press. Going over
 * to the shared answer is a separate, visible act: clear the local one.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ dir?: string; what?: 'checks' | 'sandbox'; stop?: boolean }>(event)
  const dir = body?.dir || getProjectDir(event)
  const what = body?.what

  if (!dir) throw createError({ statusCode: 400, message: 'A project directory is required' })
  if (what !== 'checks' && what !== 'sandbox') {
    throw createError({ statusCode: 400, message: 'Say what to share: checks or sandbox.' })
  }

  if (body?.stop) {
    const read = await updateSharedProject(dir, (config) => {
      if (what === 'checks') delete config.checks
      else delete config.sandbox
    })

    return { dir, what, shared: false, path: read.path, config: read.config }
  }

  if (what === 'checks') {
    // The stored value, not the resolved one: resolving would happily share a
    // guess back to the team as though somebody had decided it.
    const stored = (await projectChecksStore.read().catch(() => ({} as Record<string, string>)))[dir]

    if (stored === undefined) {
      const resolved = await checkCommandFor(dir)
      throw createError({
        statusCode: 400,
        data: {
          error: 'nothing_chosen',
          message: resolved
            ? `Nothing has been chosen here — "${resolved.command}" is a guess. Set the command first, then share it.`
            : 'Set a check command first, then share it.',
        },
      })
    }

    const read = await updateSharedProject(dir, (config) => { config.checks = { command: stored } })
    return { dir, what, shared: true, path: read.path, config: read.config }
  }

  const stored = (await projectSandboxStore.read().catch((): ProjectSandboxes => ({})))[dir]
  if (!stored) {
    const resolved = await sandboxForProject(dir)
    throw createError({
      statusCode: 400,
      data: {
        error: 'nothing_chosen',
        message: resolved.source === 'repository'
          ? 'This is already the repository’s answer. Change it here first if you want to share something else.'
          : 'Choose this project’s sandboxing first, then share it.',
      },
    })
  }

  const read = await updateSharedProject(dir, (config) => { config.sandbox = normaliseSandbox(stored) })
  return { dir, what, shared: true, path: read.path, config: read.config }
})
