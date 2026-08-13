import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guards on the design system, because it was already right and the components
 * were the ones ignoring it.
 *
 * Before this existed the app had 852 inline `style=` attributes, 506
 * hand-picked font sizes and three page widths chosen per page — which is why
 * the title moved sideways as you clicked down the sidebar and why nothing on
 * any screen read as emphatic. These tests do not enforce taste; they enforce
 * that a decision already made in `main.css` is the one actually shipping.
 */

const appDir = fileURLToPath(new URL('../app', import.meta.url))
const cssPath = join(appDir, 'assets/css/main.css')

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...vueFiles(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

const files = vueFiles(appDir).map(f => ({ path: relative(appDir, f), text: readFileSync(f, 'utf8') }))

/**
 * `file:line` for every line matching `pattern`. `keep` filters on the full
 * line rather than the truncated label, so an exemption cannot be defeated by
 * the part it matches on falling past the label's cut-off.
 */
function hits(pattern: RegExp, keep?: (line: string, path: string) => boolean): string[] {
  const found: string[] = []
  for (const { path, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (!pattern.test(line)) return
      if (keep && !keep(line, path)) return
      found.push(`${path}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  return found
}

describe('type scale', () => {
  it('has no hand-picked font sizes', () => {
    // Six roles exist for this: fs-title / fs-lg / fs-base / fs-sm / fs-mono /
    // fs-micro, or the colour-carrying type-* classes. Picking a number by hand
    // is how the scale grew to eight steps with four of them indistinguishable.
    expect(hits(/\btext-\[\d+px\]/)).toEqual([])
  })

  it('defines exactly the six steps it claims to', () => {
    const css = readFileSync(cssPath, 'utf8')
    for (const token of ['--fs-title', '--fs-lg', '--fs-base', '--fs-sm', '--fs-mono', '--fs-micro']) {
      expect(css, `${token} should be defined`).toContain(`${token}:`)
    }
    // 10px and 9px were removed deliberately. A 9px label is not restraint.
    expect(css).not.toMatch(/--fs-[a-z]+:\s*(9|10)px/)
  })
})

describe('page shell', () => {
  it('has one content width, not one per page', () => {
    // `PageHeader` used to take width="narrow|wide|full". It does not any more:
    // `bleed` distinguishes a workbench from a document, which is a real
    // distinction, applied consistently.
    expect(hits(/<PageHeader[^>]*\bwidth=/)).toEqual([])
    expect(hits(/page-container--(narrow|wide)\b/)).toEqual([])
  })

  it('every page renders its body inside the shared frame', () => {
    // A page body on a raw `px-6` sat 8px off the header's 32px gutter, so the
    // title and the content under it did not line up.
    const pages = files.filter(f => f.path.startsWith('pages/'))
    const offenders = pages
      .filter(f => /class="px-6[ "]/.test(f.text))
      .map(f => f.path)
    expect(offenders).toEqual([])
  })
})

describe('colour', () => {
  it('takes semantic colour from tokens, not literals', () => {
    // Hard-coded rgba(248,113,113) is Tailwind red-400 — neither the light
    // token (#e5484d) nor the dark one (#f85149), so an error tint looked
    // identical in both themes and matched the error text in neither.
    const literals = hits(
      /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/,
      // Modal scrims are genuinely black, and the terminal carries its own
      // theme alongside the --editor-* tokens.
      (line, path) =>
        !/rgba?\(\s*0\s*,\s*0\s*,\s*0/.test(line) &&
        path !== 'components/TerminalPane.vue',
    )
    expect(literals).toEqual([])
  })

  it('does not reference tokens that were never defined', () => {
    // `var(--info, #3b82f6)` shipped in three places without --info existing,
    // so the fallback always won and the token was decorative. Tokens a
    // component sets on its own elements and reads back in scoped CSS
    // (--block-color, --need-color) are local by design, so a definition
    // anywhere in the same file counts.
    const css = readFileSync(cssPath, 'utf8')
    const missing: string[] = []
    for (const { path, text } of files) {
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const token = m[1]!
        if (css.includes(`${token}:`)) continue
        // A local definition may be a CSS declaration (`--x: y`) or an object
        // key in a :style binding (`'--x': y`), so allow an optional quote.
        if (new RegExp(`${token}'?\\s*:`).test(text)) continue
        missing.push(`${path}  ${token}`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})
