import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Guards on the one select, because the browser's is always the easier one to
 * reach for.
 *
 * `<select>` styled with `appearance: none` looks right until it is clicked, at
 * which point the operating system draws the list: system fonts, its own row
 * height, a chevron in neither theme's grey, and nowhere to put the second line
 * of text half of these lists want. There were sixteen of them across six
 * screens. `FieldSelect` replaced all sixteen; these tests are what stops the
 * seventeenth being native again, and what stops the vim layer and the dialog
 * safeguards being quietly dropped from it.
 */

const appDir = fileURLToPath(new URL('../app', import.meta.url))

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...vueFiles(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

const files = vueFiles(appDir).map(f => ({
  path: relative(appDir, f),
  text: readFileSync(f, 'utf8'),
}))

const component = files.find(f => f.path === 'components/FieldSelect.vue')!
const css = readFileSync(join(appDir, 'assets/css/main.css'), 'utf8')

describe('nothing in the app chooses with a native select', () => {
  it('has no <select> elements left', () => {
    // `FieldSelect` itself is exempt: the only `<select>` left in the app is
    // the word, in the comment explaining what it replaced.
    const offenders = files
      .filter(f => f.path !== 'components/FieldSelect.vue')
      .filter(f => /<select[\s>]/.test(f.text))
      .map(f => f.path)
    expect(offenders).toEqual([])
  })

  it('has no <option> outside a datalist', () => {
    // A `<datalist>` is a different thing — an autocomplete on a free-text
    // input, which `FieldSelect` deliberately does not replace.
    const offenders: string[] = []
    for (const { path, text } of files) {
      const withoutDatalists = text.replace(/<datalist[\s\S]*?<\/datalist>/g, '')
      if (/<option[\s>]/.test(withoutDatalists)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  it('does not leave the styles the native select needed', () => {
    // `.field-select` was `appearance: none` plus a chevron background image
    // with a hard-coded grey in it. Left behind, it is an invitation.
    expect(css).not.toContain('.field-select')
  })

  it('styles the one that replaced it in the stylesheet, not inline', () => {
    expect(css).toContain('.select-trigger')
    expect(css).toContain('.select-menu')
    expect(component.text).not.toMatch(/\sstyle="[^"]/)
  })
})

describe('the menu survives the dialogs it opens inside', () => {
  it('is teleported out and positioned against the viewport', () => {
    // A dialog panel scrolls, and an absolutely positioned menu inside a scroll
    // container is clipped by it.
    expect(component.text).toContain('<Teleport to="body">')
    expect(css).toMatch(/\.select-menu\s*\{[^}]*position:\s*fixed/)
  })

  it('takes its pointer events back from the modal', () => {
    // An open Nuxt UI modal sets `pointer-events: none` on the body, and a
    // teleported menu is no longer inside the modal to be excepted from it.
    expect(css).toMatch(/\.select-menu\s*\{[^}]*pointer-events:\s*auto/)
  })

  it('keeps a click on an option from reading as a click outside the dialog', () => {
    // `.prevent` keeps focus on the trigger, inside the dialog's focus trap;
    // `.stop` keeps the dialog's dismiss layer from ever seeing the click.
    expect(component.text).toContain('@pointerdown.prevent.stop')
    // Which is why the close-on-outside-click listener has to be in the capture
    // phase: a bubble listener would never hear the clicks that matter.
    expect(component.text).toMatch(/addEventListener\('pointerdown', onDocumentPointerDown, true\)/)
  })

  it('swallows the Escape that closes it', () => {
    // Left to bubble, it would reach the dialog and take the half-filled form.
    expect(component.text).toMatch(/'Escape'[\s\S]{0,120}stopPropagation/)
  })

  it('never moves focus off the trigger', () => {
    // Options are `role="option"` divs pointed at by aria-activedescendant.
    // Buttons would pull focus out of a modal's focus trap mid-click.
    expect(component.text).toContain('aria-activedescendant')
    expect(component.text).toContain('role="option"')
    expect(component.text).not.toMatch(/<button[^>]*role="option"/)
  })
})

describe('the keys are vim keys', () => {
  const source = component.text

  it('moves on j and k, with counts', () => {
    expect(source).toMatch(/key === 'j'[\s\S]{0,60}move\(takeCount\(\)\)/)
    expect(source).toMatch(/key === 'k'[\s\S]{0,60}move\(-takeCount\(\)\)/)
    expect(source).toContain('function takeCount()')
  })

  it('jumps on gg and G', () => {
    expect(source).toContain('pendingG')
    expect(source).toMatch(/key === 'G'[\s\S]{0,80}jump\(matches\.value\.length - 1\)/)
  })

  it('answers to ⌃n / ⌃p and ⌃d / ⌃u', () => {
    expect(source).toMatch(/key === 'n' \|\| key === 'j'/)
    expect(source).toMatch(/key === 'p' \|\| key === 'k'/)
    expect(source).toMatch(/key === 'd'[\s\S]{0,40}move\(half\)/)
    expect(source).toMatch(/key === 'u'[\s\S]{0,40}move\(-half\)/)
  })

  it('narrows on / rather than on any letter typed', () => {
    // Native typeahead — jump to the option starting with the letter pressed —
    // cannot coexist with `j` meaning down. So `/` opens a filter, and the
    // footer says it does.
    expect(source).toMatch(/key === '\/'[\s\S]{0,80}filtering\.value = true/)
    expect(source).toContain('/ to narrow')
    expect(source).toContain('j/k to move')
  })

  it('leaves on q and on Escape', () => {
    expect(source).toMatch(/key === 'q'[\s\S]{0,40}closeMenu\(\)/)
  })
})

describe('every call site says what it is choosing', () => {
  it('passes an aria-label, because the trigger only shows the value', () => {
    const offenders: string[] = []
    for (const { path, text } of files) {
      if (path === 'components/FieldSelect.vue') continue
      for (const tag of text.matchAll(/<FieldSelect[\s\S]*?\/>/g)) {
        if (!/(:aria-label|aria-label)=/.test(tag[0])) {
          offenders.push(`${path}: ${tag[0].split('\n')[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('is used somewhere — a guard on a component nobody renders is theatre', () => {
    const users = files.filter(f =>
      f.path !== 'components/FieldSelect.vue' && f.text.includes('<FieldSelect'),
    )
    expect(users.length).toBeGreaterThanOrEqual(6)
  })
})
