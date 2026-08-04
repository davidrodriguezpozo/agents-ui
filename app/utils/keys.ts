/**
 * Whether a keypress in a message box means "send this".
 *
 * Enter sends and Shift+Enter breaks the line — the convention every chat
 * people already use follows, and the one worth matching, because the habit is
 * in their hands before they read any hint text.
 *
 * Shared rather than written per box so the boxes cannot drift apart. A
 * composer that sends on ⌘↵ while the panel beside it sends on ↵ is a small
 * thing that goes wrong every single time.
 */
export function isSendKey(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false

  // Shift+Enter is the new line.
  if (event.shiftKey) return false

  /**
   * Mid-composition Enter is confirming a character, not sending a message —
   * it is how Japanese, Chinese and Korean input works. Sending here would
   * fire on the word being typed and swallow it. `keyCode === 229` is the
   * older signal for the same thing, kept because not every browser sets
   * `isComposing` on every event in the sequence.
   */
  if (event.isComposing || event.keyCode === 229) return false

  // ⌘↵ still sends, so anyone who learned that keeps it.
  return true
}

/**
 * True when the keypress should insert a newline instead of sending —
 * the inverse of the above, for boxes that need to say so explicitly.
 */
export function isNewlineKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && event.shiftKey
}
