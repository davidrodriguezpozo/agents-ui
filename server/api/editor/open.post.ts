import { EDITOR_CHOICES, openInEditor, type EditorChoice } from '../../utils/editors'
import { readPreferences, savePreferences } from '../../utils/preferences'

/**
 * Open a worktree in an editor on this machine.
 *
 * Server-side rather than a link in the page, for two reasons. The browser
 * cannot navigate an `http` page to a `file` URL, so "Reveal in Finder" is not
 * available to it at all; and nothing in the browser knows whether the
 * directory is still there, so a worktree removed outside the app would give a
 * button that appears to do nothing. Here both are one answer.
 *
 * Naming an editor also stores it, because the menu on the button is the only
 * place the choice is made — see `editors.ts` and `Preferences.editor`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ path?: string; editor?: EditorChoice }>(event)

  const path = body?.path?.trim()
  if (!path) throw createError({ statusCode: 400, message: 'No workspace path was sent.' })

  const named = EDITOR_CHOICES.includes(body?.editor as EditorChoice) ? body!.editor! : null
  const editor = named ?? (await readPreferences()).editor

  // Stored whether or not the directory turns out to be there. Which editor you
  // use is a fact about the machine; a worktree that has been deleted says
  // nothing about it, and making you pick twice would be the wrong lesson.
  if (named) await savePreferences({ editor: named })

  try {
    return { editor, ...await openInEditor(editor, path) }
  } catch (e) {
    throw createError({ statusCode: 400, message: (e as Error).message })
  }
})
