import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../app/utils/markdown'

/**
 * The one thing rendered markdown has to offer that reading does not: taking the
 * block with you.
 *
 * Every fenced block in this app is something somebody is about to run — the
 * `gh pr review` line a session composed, a command a brief printed — and up to
 * now the only way to get one was to select it by hand, in a `<pre>` that scrolls
 * sideways. So the renderer wraps each block with a button, and these tests are
 * about the two ways that goes wrong: the copy losing the code, and the wrapper
 * escaping something it should not.
 */
describe('renderMarkdown, on a fenced block', () => {
  const fenced = '```bash\ngh pr create --title "x"\n```'

  it('wraps it in a block with a button that copies it', () => {
    const html = renderMarkdown(fenced)
    expect(html).toContain('class="code-block"')
    expect(html).toContain('class="code-copy"')
    // A real button, so the keyboard reaches it and Enter presses it.
    expect(html).toContain('<button type="button"')
    expect(html).toContain('<pre>')
  })

  it('keeps the code as the code, escaped once', () => {
    const html = renderMarkdown(fenced)
    // The button reads its text out of the `<code>` element, so what is in there
    // has to be the whole command — and `"` escaped once, not twice.
    expect(html).toContain('gh pr create --title &quot;x&quot;')
    expect(html).not.toContain('&amp;quot;')
  })

  it('keeps the language, which is what the highlighting hangs off', () => {
    expect(renderMarkdown(fenced)).toContain('class="language-bash"')
  })

  it('says nothing about a language when the fence did not', () => {
    const html = renderMarkdown('```\nplain\n```')
    expect(html).toContain('<code>')
    expect(html).not.toContain('language-')
  })

  it('escapes a language that is not one', () => {
    // The fence's info string is text somebody else wrote. It reaches an
    // attribute, so it cannot be allowed to close one.
    const html = renderMarkdown('```"><script>alert(1)</script>\nx\n```')
    expect(html).not.toContain('<script>')
  })

  it('leaves inline code alone', () => {
    const html = renderMarkdown('press `make check` first')
    expect(html).toContain('<code>make check</code>')
    expect(html).not.toContain('code-copy')
  })
})
