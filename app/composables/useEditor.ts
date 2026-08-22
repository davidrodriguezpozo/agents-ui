/**
 * Which editor this machine opens a worktree in, and the press that does it.
 *
 * Shared rather than per-button: the choice is remembered on the server, and a
 * session header and a Workspaces row are usually on screen at the same time.
 * Two copies of the state would mean picking Cursor in one place and still
 * being offered VS Code in the other until a reload.
 *
 * Mirrors `EditorChoice` in `server/utils/editors.ts`, which is the authority —
 * it holds the URL schemes and is what actually launches anything.
 */
export type EditorChoice = 'vscode' | 'cursor' | 'zed' | 'finder'

export interface EditorOption {
  id: EditorChoice
  /** Named by the server, because the file manager's name is per-platform. */
  label: string
}

/**
 * Module-level rather than `useState`, because it holds a promise: this is one
 * browser tab's in-flight request, not state worth carrying across a render.
 */
let inFlight: Promise<void> | null = null

export function useEditor() {
  const choice = useState<EditorChoice>('editor-choice', () => 'vscode')
  const options = useState<EditorOption[]>('editor-options', () => [])
  const opening = useState<string | null>('editor-opening', () => null)

  /**
   * Once per page, and never worth failing anything over: the defaults draw.
   *
   * The request is held rather than the result, because a Workspaces panel
   * mounts a dozen of these buttons in the same tick and each one calls this —
   * a flag set after the reply would let all twelve through first.
   */
  async function load() {
    if (options.value.length) return
    inFlight ??= $fetch<{ editor: EditorChoice; choices: EditorOption[] }>('/api/editor')
      .then((state) => {
        choice.value = state.editor
        options.value = state.choices
      })
      .catch((e) => { console.error('[useEditor] load:', e) })
      .finally(() => { inFlight = null })

    await inFlight
  }

  /**
   * Open a worktree. Naming an editor also makes it the one the button uses
   * from now on, which is the whole of how the choice is made — there is no
   * setting for this anywhere else.
   *
   * `opening` is keyed by path so a list of rows can show which one is going.
   */
  async function openIn(path: string, editor?: EditorChoice) {
    opening.value = path
    try {
      const result = await $fetch<{ editor: EditorChoice; url: string; name: string }>(
        '/api/editor/open',
        { method: 'POST', body: { path, editor } },
      )
      if (editor) choice.value = editor
      return result
    } finally {
      opening.value = null
    }
  }

  const label = computed(() =>
    options.value.find(o => o.id === choice.value)?.label ?? 'VS Code')

  return { choice, options, opening, label, load, openIn }
}
