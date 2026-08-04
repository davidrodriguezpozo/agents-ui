import { describe, expect, it } from 'vitest'
import { titleFromPrompt } from '../server/utils/sessions'

describe('titleFromPrompt', () => {
  it('uses a short instruction as it stands', () => {
    expect(titleFromPrompt('Fix the flaky upload test')).toBe('Fix the flaky upload test')
  })

  it('takes the first line of a longer prompt', () => {
    const prompt = 'Fix the flaky upload test\n\nIt fails on CI about one run in five,\nalways in the retry path.'
    expect(titleFromPrompt(prompt)).toBe('Fix the flaky upload test')
  })

  it('cuts a long first line at a word, not mid-word', () => {
    const prompt = 'Work out why the nightly migration job leaves the accounts table locked for several minutes'
    const title = titleFromPrompt(prompt)

    expect(title.length).toBeLessThanOrEqual(71)
    expect(title.endsWith('…')).toBe(true)

    // The kept text must end where a word ends in the original — otherwise it
    // has been cut through the middle of one.
    const kept = title.slice(0, -1)
    expect(prompt.startsWith(kept)).toBe(true)
    expect(prompt[kept.length]).toBe(' ')
  })

  it('skips a markdown heading marker to the words after it', () => {
    // A prompt opening with `# Goal` would otherwise be titled `#`.
    expect(titleFromPrompt('# Rewrite the installer')).toBe('Rewrite the installer')
    expect(titleFromPrompt('## Goal\n\nRewrite the installer')).toBe('Goal')
  })

  it('skips leading blank and punctuation-only lines', () => {
    expect(titleFromPrompt('\n\n---\n\nBump the linter')).toBe('Bump the linter')
  })

  it('handles a prompt that opens with a bullet', () => {
    expect(titleFromPrompt('- Update the README')).toBe('Update the README')
  })

  it('falls back rather than producing an empty name', () => {
    expect(titleFromPrompt('')).toBe('Untitled session')
    expect(titleFromPrompt('   \n\n  ')).toBe('Untitled session')
    expect(titleFromPrompt('###')).toBe('Untitled session')
  })

  it('does not cut a line that is exactly at the limit', () => {
    const exact = 'a'.repeat(70)
    expect(titleFromPrompt(exact)).toBe(exact)
  })

  it('cuts a single unbroken word rather than returning nothing', () => {
    // No space to fall back to, so the word boundary is ignored on purpose.
    const title = titleFromPrompt('x'.repeat(200))
    expect(title).toBe(`${'x'.repeat(70)}…`)
  })
})
