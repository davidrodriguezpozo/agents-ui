import { EDITOR_CHOICES, editorName } from '../../utils/editors'
import { readPreferences } from '../../utils/preferences'

/**
 * What the "Open in" button offers, and which one it presses by default.
 *
 * The list is sent rather than written into the page because the last of the
 * four is named by the platform — "Finder" on macOS, "File Explorer" on
 * Windows — and the browser has no business guessing which machine the server
 * is on.
 */
export default defineEventHandler(async () => ({
  editor: (await readPreferences()).editor,
  choices: EDITOR_CHOICES.map(id => ({ id, label: editorName(id) })),
}))
