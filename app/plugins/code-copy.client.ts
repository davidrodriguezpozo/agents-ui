/**
 * The press behind the copy button on every fenced code block.
 *
 * One listener for the whole app, on the document, because the markup it acts on
 * is injected with `v-html` — six components do it, and the one that matters
 * re-injects on every token of a streaming turn. There is no component to bind a
 * handler to and no mounted hook that would survive the next re-render, so
 * binding per block would mean re-binding forever. Delegation is not a shortcut
 * here; it is the only version that stays correct.
 *
 * The button holds no copy of the code — see `~/utils/markdown`, which renders
 * it. What lands on the clipboard is read out of the `<code>` element at the
 * moment of the press, so it is exactly what is on the screen.
 */
export default defineNuxtPlugin(() => {
  /**
   * Buttons on their way back to "Copy". Weak, so a block that a streaming turn
   * has replaced is not held alive by a pending timer, and keyed so a second
   * press restarts the moment rather than ending it early.
   */
  const settling = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

  /**
   * Said on the button itself rather than in a toast: the press is a small one,
   * it happens in the middle of reading something, and a notification in the
   * corner for it would be louder than the thing it reports.
   */
  function flash(button: HTMLElement, state: 'copied' | 'refused') {
    button.dataset.state = state
    button.title = state === 'copied' ? 'Copied' : 'Your browser refused the clipboard'

    const pending = settling.get(button)
    if (pending) clearTimeout(pending)

    settling.set(button, setTimeout(() => {
      delete button.dataset.state
      button.title = 'Copy'
      settling.delete(button)
    }, 1600))
  }

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('.code-copy')
    if (!button) return

    const code = button.closest('.code-block')?.querySelector('code')?.textContent
    if (!code) return

    // Absent on a page served over plain HTTP to another machine, which this app
    // supports — say so on the button rather than doing nothing.
    if (!navigator.clipboard) {
      flash(button, 'refused')
      return
    }

    // The renderer ends every block with a newline so the `<pre>` closes on its
    // own line. Nobody wants that on the clipboard.
    void navigator.clipboard.writeText(code.replace(/\n$/, ''))
      .then(() => flash(button, 'copied'))
      .catch(() => flash(button, 'refused'))
  })
})
