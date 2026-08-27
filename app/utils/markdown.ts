import { marked } from 'marked'
import type { Tokens } from 'marked'

marked.setOptions({
  breaks: true,
  gfm: true,
})

/**
 * Every fenced block gets the button that copies it.
 *
 * Done in the renderer rather than in the six places that render markdown,
 * because it is a fact about a code block and not about a page: a session's
 * output, a run's, the Studio's, a plugin's readme. A fenced block in this app
 * is almost always something somebody is about to run — the `gh` line a session
 * composed, a command a brief printed — and the only way to take one was to
 * select it by hand out of a `<pre>` that scrolls sideways.
 *
 * The button carries no copy of the code. It is next to it, and the press reads
 * the `<code>` element's own text, so what lands on the clipboard is exactly
 * what is on the screen and there is nothing to keep in step. The press itself
 * lives in `app/plugins/code-copy.client.ts` — one listener for the whole app,
 * because this HTML is injected with `v-html` and re-injected on every token of
 * a streaming turn, and nothing can be bound to it.
 */
const COPY_ICON = '<svg class="code-copy__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect width="14" height="14" x="8" y="8" rx="2"/>'
  + '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'

const DONE_ICON = '<svg class="code-copy__done" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
  + 'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M20 6 9 17l-5-5"/></svg>'

/**
 * The fence's info string is text somebody else wrote, and it reaches an
 * attribute — so it is escaped like the body, not trusted like markup.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&(?!#?\w+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

marked.use({
  renderer: {
    code({ text, lang, escaped }: Tokens.Code): string {
      // Only the first word: ```ts twoslash is a language and a directive.
      const language = (lang ?? '').trim().split(/\s+/)[0] ?? ''
      const attribute = language ? ` class="language-${escapeHtml(language)}"` : ''
      const body = escaped ? text : escapeHtml(text)

      return '<div class="code-block">'
        + '<button type="button" class="code-copy" data-copy aria-label="Copy code" title="Copy">'
        + `${COPY_ICON}${DONE_ICON}</button>`
        + `<pre><code${attribute}>${body}\n</code></pre></div>\n`
    },
  },
})

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string
}
