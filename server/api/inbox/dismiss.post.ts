import { findInboxSource, inboxStore } from '../../utils/inbox'

/**
 * Wave one away.
 *
 * Kept per source rather than globally, and keyed on the URL rather than the
 * wording, so it survives a refresh that renames the page or rewrites the
 * reason. A refresh drops dismissals for anything no longer waiting — otherwise
 * an item that came back would stay invisible.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ source?: string; id?: string }>(event)
    .catch(() => ({} as { source?: string; id?: string }))

  const source = findInboxSource(String(body?.source ?? ''))
  const id = String(body?.id ?? '').trim()

  if (!source || !id) {
    throw createError({
      statusCode: 400,
      data: { error: 'bad_request', message: 'Needs a known source and an item id.' },
    })
  }

  await inboxStore.update((inbox) => {
    const state = inbox.sources.find(s => s.source === source.key)
    if (!state) return
    const dismissed = new Set(state.dismissed ?? [])
    dismissed.add(id)
    state.dismissed = [...dismissed]
  })

  return { ok: true }
})
