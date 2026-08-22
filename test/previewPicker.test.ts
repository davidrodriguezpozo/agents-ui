import { describe, expect, it } from 'vitest'
import { PICKER_PATH, injectPicker, isHtmlResponse, pickerScript } from '../server/utils/previewPicker'

/**
 * The script is added to somebody else's page, so the two things worth pinning
 * down are that it lands somewhere a browser will run it and that it lands on
 * HTML and nothing else. A stylesheet with a `<script>` tag appended is a
 * corrupted stylesheet.
 */

describe('adding the picker to a page', () => {
  it('goes before the closing head tag', () => {
    const out = injectPicker('<html><head><title>x</title></head><body>hi</body></html>')

    expect(out).toContain(`<script src="${PICKER_PATH}"`)
    expect(out.indexOf(PICKER_PATH)).toBeLessThan(out.indexOf('</head>'))
  })

  it('is deferred, so it runs after the body it draws into exists', () => {
    expect(injectPicker('<head></head>')).toContain('defer')
  })

  it('falls back to the end of the body when there is no head', () => {
    const out = injectPicker('<body><div id="app"></div></body>')

    expect(out.indexOf(PICKER_PATH)).toBeLessThan(out.indexOf('</body>'))
  })

  it('appends to a fragment that closes neither', () => {
    expect(injectPicker('<div id="app"></div>')).toBe(
      `<div id="app"></div><script src="${PICKER_PATH}" defer data-agents-ui-picker="script"></script>`,
    )
  })

  it('does not add a second copy', () => {
    const once = injectPicker('<head></head>')

    expect(injectPicker(once)).toBe(once)
  })

  it('leaves an empty body alone', () => {
    expect(injectPicker('')).toBe('')
  })

  it('tolerates a sloppily closed head', () => {
    expect(injectPicker('<HEAD></HEAD >')).toContain(PICKER_PATH)
  })
})

describe('deciding what to rewrite', () => {
  it('rewrites html', () => {
    expect(isHtmlResponse('text/html; charset=utf-8')).toBe(true)
    expect(isHtmlResponse('application/xhtml+xml')).toBe(true)
  })

  it('leaves everything else as it came', () => {
    expect(isHtmlResponse('application/javascript')).toBe(false)
    expect(isHtmlResponse('text/css')).toBe(false)
    // A near miss: not HTML, and a script tag in it would be a broken document.
    expect(isHtmlResponse('text/html-sandboxed')).toBe(false)
    expect(isHtmlResponse(undefined)).toBe(false)
    expect(isHtmlResponse('')).toBe(false)
  })
})

describe('the script itself', () => {
  const script = pickerScript()

  /**
   * The selector rules are shipped by embedding the function's own source, so
   * a bundler that inlined a helper into it would leave the page calling a name
   * it has never heard of. Nothing to assert about that but the shape: the
   * rules are in there, and they are in there once.
   */
  it('carries the selector builder with it', () => {
    expect(script).toContain('nth-child(')
    expect(script).toContain('parentElement')
    expect(script).toMatch(/var selectorFor = function selectorFor\b|var selectorFor = \(/)
  })

  it('is valid javascript', () => {
    expect(() => new Function(script)).not.toThrow()
  })

  it('cannot close the tag it is served in', () => {
    expect(script).not.toContain('</script')
  })

  it('does nothing until the host asks', () => {
    // Point mode is off at load: the script is in somebody else's page and a
    // page that starts swallowing clicks on its own is a broken preview.
    expect(script).toContain('var on = false')
  })
})
