import { describe, expect, it } from 'vitest'
import { selectorFor, type SelectorElement } from '../server/utils/previewSelector'

/**
 * The selector is the whole payload of a click in the preview: if it does not
 * land on the element somebody pointed at, the note that carries it sends the
 * agent to the wrong place with full confidence.
 *
 * Elements are built out of object literals rather than a DOM, because the
 * suite runs in `node` and `selectorFor` is deliberately structural — the same
 * shape a real `Element` happens to satisfy.
 */

interface Spec {
  tag: string
  id?: string
  class?: string
  kids?: Spec[]
}

/** Builds a tree with the parent and sibling links `selectorFor` walks. */
function tree(spec: Spec): SelectorElement {
  const node: SelectorElement & { children: SelectorElement[] } = {
    tagName: spec.tag.toUpperCase(),
    id: spec.id ?? '',
    className: spec.class ?? '',
    parentElement: null,
    children: [],
  }

  for (const kid of spec.kids ?? []) {
    const child = tree(kid)
    child.parentElement = node
    node.children.push(child)
  }

  return node
}

/** The nth element at the given path of child indexes. */
function at(root: SelectorElement, ...path: number[]): SelectorElement {
  let node = root
  for (const index of path) node = node.children![index]!
  return node
}

describe('naming an element', () => {
  it('uses an id alone, and stops there', () => {
    const root = tree({ tag: 'body', kids: [{ tag: 'main', kids: [{ tag: 'button', id: 'save' }] }] })

    expect(selectorFor(at(root, 0, 0))).toBe('#save')
  })

  it('anchors the path at the nearest ancestor with an id', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'div', id: 'app', kids: [{ tag: 'main', kids: [{ tag: 'p' }] }] }],
    })

    expect(selectorFor(at(root, 0, 0, 0))).toBe('#app > main > p')
  })

  it('uses classes when it has them', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'div', class: 'card', kids: [{ tag: 'button', class: 'btn primary' }] }],
    })

    expect(selectorFor(at(root, 0, 0))).toBe('body > div.card > button.btn.primary')
  })

  it('keeps two classes at most, so the selector stays readable', () => {
    const root = tree({ tag: 'body', kids: [{ tag: 'div', class: 'flex items-center gap-2 px-3' }] })

    expect(selectorFor(at(root, 0))).toBe('body > div.flex.items-center')
  })

  it('drops framework bookkeeping, which says nothing about which element it is', () => {
    const root = tree({ tag: 'body', kids: [{ tag: 'div', class: 'svelte-1x2y3z card' }] })

    expect(selectorFor(at(root, 0))).toBe('body > div.card')
  })

  it('falls back to nth-child when a sibling answers to the same thing', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'ul', kids: [{ tag: 'li' }, { tag: 'li' }, { tag: 'li' }] }],
    })

    expect(selectorFor(at(root, 0, 1))).toBe('body > ul > li:nth-child(2)')
  })

  it('counts nth-child among all siblings, not just the matching ones', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'div', kids: [{ tag: 'h2' }, { tag: 'p' }, { tag: 'p' }] }],
    })

    // The second <p> is the third child.
    expect(selectorFor(at(root, 0, 2))).toBe('body > div > p:nth-child(3)')
  })

  it('leaves nth-child off when the classes already tell them apart', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'div', kids: [{ tag: 'span', class: 'label' }, { tag: 'span', class: 'value' }] }],
    })

    expect(selectorFor(at(root, 0, 1))).toBe('body > div > span.value')
  })

  it('adds nth-child when siblings share the same classes too', () => {
    const root = tree({
      tag: 'body',
      kids: [{ tag: 'div', kids: [{ tag: 'span', class: 'chip' }, { tag: 'span', class: 'chip' }] }],
    })

    expect(selectorFor(at(root, 0, 1))).toBe('body > div > span.chip:nth-child(2)')
  })

  it('ignores an id that would need escaping', () => {
    const root = tree({ tag: 'body', kids: [{ tag: 'div', id: '2:cols', class: 'grid' }] })

    expect(selectorFor(at(root, 0))).toBe('body > div.grid')
  })

  it('names the body and the html element as themselves', () => {
    const root = tree({ tag: 'body', kids: [{ tag: 'div' }] })

    expect(selectorFor(root)).toBe('body')
  })

  it('answers nothing for nothing', () => {
    expect(selectorFor(null)).toBe('')
    expect(selectorFor(undefined)).toBe('')
  })
})

describe('shortening a selector', () => {
  const root = tree({
    tag: 'body',
    kids: [{ tag: 'div', class: 'shell', kids: [{ tag: 'main', kids: [{ tag: 'button', class: 'btn' }] }] }],
  })
  const button = at(root, 0, 0, 0)

  it('returns the shortest suffix that still matches one element', () => {
    // The page says `button.btn` is unique, so the path above it is noise.
    expect(selectorFor(button, sel => (sel === 'button.btn' ? 1 : 2))).toBe('button.btn')
  })

  it('keeps as much of the path as uniqueness needs', () => {
    const unique = new Set(['main > button.btn'])

    expect(selectorFor(button, sel => (unique.has(sel) ? 1 : 3))).toBe('main > button.btn')
  })

  it('falls back to the full path when nothing shorter is unique', () => {
    expect(selectorFor(button, () => 4)).toBe('body > div.shell > main > button.btn')
  })

  it('returns the full path when the page cannot be asked', () => {
    expect(selectorFor(button)).toBe('body > div.shell > main > button.btn')
  })
})
