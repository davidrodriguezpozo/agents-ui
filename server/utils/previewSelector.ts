/**
 * Naming the element somebody pointed at.
 *
 * Pointing at a button in the preview is only useful if the agent can find that
 * button in the source, and "the blue one near the top" is not a thing you can
 * grep for. A CSS selector is: `button.primary` or `#save` lands in a template
 * almost immediately, and the class names in it are usually the words the file
 * uses too.
 *
 * This is a plain function on purpose. It runs inside the previewed page, where
 * it arrives as text — `server/utils/previewPicker.ts` embeds it with
 * `Function.prototype.toString()` so there is one copy of the rules rather than
 * one that is tested and one that ships. That is the constraint to respect when
 * editing it: **it must reference nothing outside itself.** No imports, no
 * module-level constants, no sibling helpers. Anything it closes over would be
 * renamed or dropped by the server bundler and the injected copy would throw on
 * a name the page has never heard of.
 *
 * The element type is structural rather than `Element` for the same reason: the
 * server has no DOM to type against, and a shape a real `Element` satisfies is
 * also a shape a test can build out of object literals.
 */

export interface SelectorElement {
  tagName: string
  id?: string | null
  className?: string | null
  parentElement?: SelectorElement | null
  /** Element children, in document order. An `HTMLCollection` satisfies this. */
  children?: { length: number, [index: number]: SelectorElement } | null
}

/**
 * The shortest selector that still means this one element.
 *
 * `count` answers "how many elements match this?" — in the page that is
 * `document.querySelectorAll(sel).length`. Given it, the path is trimmed from
 * the left to the shortest suffix that still matches exactly one thing, because
 * `body > div > div:nth-child(2) > main > form > button` is technically correct
 * and reads like nothing. Without it the full path is returned, which is longer
 * and never wrong.
 */
export function selectorFor(
  element: SelectorElement | null | undefined,
  count?: ((selector: string) => number) | null,
): string {
  if (!element || !element.tagName) return ''

  const idOk = /^[A-Za-z][\w-]*$/
  const classOk = /^[A-Za-z_][\w-]*$/
  // Framework bookkeeping: a scoped-style hash or a transition flag says
  // nothing about which element this is and changes between builds.
  const noise = /^(ng-|v-|svelte-|css-|sc-|jsx-|emotion-|data-v-|_)/

  /** Tag and classes — what an element answers to, ignoring where it sits. */
  const label = (node: SelectorElement): string => {
    const tag = String(node.tagName || '').toLowerCase()
    if (!tag) return ''

    const raw = node.className ? String(node.className) : ''
    let out = tag
    let kept = 0
    for (const name of raw.split(/\s+/)) {
      if (!name || !classOk.test(name) || noise.test(name)) continue
      out += '.' + name
      kept++
      if (kept === 2) break
    }
    return out
  }

  /**
   * One step of the path.
   *
   * `:nth-child` is the fallback and only the fallback: it is added when a
   * sibling answers to the same tag and classes, which is exactly the case
   * where nothing else distinguishes them. A named element does not get a
   * position bolted on to it.
   */
  const segment = (node: SelectorElement): string => {
    const tag = String(node.tagName || '').toLowerCase()
    if (tag === 'body' || tag === 'html') return tag

    const id = node.id ? String(node.id) : ''
    if (id && idOk.test(id)) return '#' + id

    const self = label(node)
    const siblings = node.parentElement ? node.parentElement.children : null
    if (!siblings || !siblings.length) return self

    let index = 0
    let ambiguous = false
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i]
      if (!sibling) continue
      if (sibling === node) {
        index = i + 1
        continue
      }
      if (label(sibling) === self) ambiguous = true
    }

    return ambiguous && index ? self + ':nth-child(' + index + ')' : self
  }

  const parts: string[] = []
  let node: SelectorElement | null | undefined = element
  // A page deep enough to need more than this has a selector nobody will read.
  while (node && node.tagName && parts.length < 24) {
    const step = segment(node)
    if (!step) break
    parts.unshift(step)

    // An id is unique in a document, so the path above it adds nothing.
    if (step.charAt(0) === '#') break

    const tag = String(node.tagName).toLowerCase()
    if (tag === 'body' || tag === 'html') break
    node = node.parentElement
  }

  const full = parts.join(' > ')
  if (!count) return full

  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(i).join(' > ')
    if (candidate && count(candidate) === 1) return candidate
  }

  return full
}
