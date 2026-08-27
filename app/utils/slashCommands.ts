/**
 * When a message box offers its command list, and what it filters by.
 *
 * The rule lived twice: once in the session composer, which has had the list
 * since it shipped, and nowhere at all in the box that starts a session — so
 * `/code-review` typed into the one place a session actually begins went off as
 * literal text in the first turn. Same gesture, same box, two answers.
 *
 * Here rather than in `CommandPalette.vue` so the decision can be tested
 * without mounting anything, and so the two boxes cannot drift apart.
 */

/**
 * Whether what has been typed is somebody reaching for a command.
 *
 * A bare slash-word: the moment you are trying to remember a name. The space
 * ends it — past the command itself you are writing arguments, and a list of
 * everything installed hovering over the box for the rest of a long
 * instruction is in the way rather than helpful.
 */
export function offersCommands(text: string): boolean {
  return text.startsWith('/') && !text.includes(' ')
}

/**
 * The word typed after the slash, which is what the list filters on. Empty
 * when the box is not on a bare slash-word — an empty query lists everything,
 * which is what the button beside the box wants.
 */
export function slashQuery(text: string): string {
  const match = text.match(/^\/(\S*)$/)
  return match?.[1] ?? ''
}
