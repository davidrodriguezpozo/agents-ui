import { describe, expect, it } from 'vitest'
import { describeToolCall, filesTouched, shortenPath } from '../app/utils/toolCalls'

/**
 * Watching a turn work is only useful if each step says something. The raw
 * arguments are the opposite of that: a `file_path` inside an `Edit` is the one
 * part worth reading and the rest is scaffolding.
 */

describe('describing a step', () => {
  it('names the file for the tools that touch one', () => {
    expect(describeToolCall({ toolName: 'Edit', input: { file_path: '/repo/src/pricing.ts' } }, '/repo'))
      .toMatchObject({ verb: 'Edited', target: 'src/pricing.ts', writes: true })

    expect(describeToolCall({ toolName: 'Read', input: { file_path: '/repo/src/pricing.ts' } }, '/repo'))
      .toMatchObject({ verb: 'Read', writes: false })
  })

  it('keeps the whole path when it does not know where the worktree is', () => {
    // Callers pass the session's worktree; without one there is nothing to
    // strip and inventing a prefix would be a guess.
    expect(describeToolCall({ toolName: 'Edit', input: { file_path: '/repo/src/pricing.ts' } }).target)
      .toBe('repo/src/pricing.ts')
  })

  it('shows the command for a shell step, since that is the whole content', () => {
    expect(describeToolCall({ toolName: 'Bash', input: { command: 'pnpm test --run' } }))
      .toMatchObject({ verb: 'Ran', target: 'pnpm test --run' })
  })

  it('shows what a search was looking for', () => {
    expect(describeToolCall({ toolName: 'Grep', input: { pattern: 'applyTax' } }).target).toBe('applyTax')
    expect(describeToolCall({ toolName: 'Glob', input: { pattern: '**/*.sql' } }).target).toBe('**/*.sql')
  })

  it('says who a subagent step went to', () => {
    expect(describeToolCall({ toolName: 'Task', input: { description: 'review the migration' } }))
      .toMatchObject({ verb: 'Delegated', target: 'review the migration' })
  })

  it('still says something for a tool it has never heard of', () => {
    // A plugin can introduce any tool it likes; a blank row would be worse
    // than an ugly one.
    const described = describeToolCall({ toolName: 'mcp__linear__create_issue', input: { url: 'https://x' } })

    expect(described.verb).toBe('mcp__linear__create_issue')
    expect(described.target).toBe('https://x')
  })

  it('copes with a step whose arguments are missing or the wrong shape', () => {
    expect(describeToolCall({ toolName: 'Edit' }).target).toBe('')
    expect(describeToolCall({ toolName: 'Bash', input: 'not an object' }).target).toBe('')
    expect(describeToolCall({ toolName: 'Bash', input: { command: 42 } }).target).toBe('')
  })
})

describe('shortening a path', () => {
  it('drops the worktree prefix, which is the same on every line', () => {
    expect(shortenPath('/wt/abc/src/lib/pricing.ts', '/wt/abc')).toBe('src/lib/pricing.ts')
  })

  it('keeps the tail of something deeply nested', () => {
    expect(shortenPath('/wt/abc/a/b/c/d/e.ts', '/wt/abc')).toBe('…/d/e.ts')
  })

  it('leaves a path outside the worktree alone', () => {
    expect(shortenPath('/etc/hosts', '/wt/abc')).toBe('etc/hosts')
  })
})

describe('what a turn changed', () => {
  it('lists written files once each, in the order first touched', () => {
    const files = filesTouched([
      { toolName: 'Read', input: { file_path: '/wt/a/README.md' } },
      { toolName: 'Edit', input: { file_path: '/wt/a/src/b.ts' } },
      { toolName: 'Edit', input: { file_path: '/wt/a/src/b.ts' } },
      { toolName: 'Write', input: { file_path: '/wt/a/src/c.ts' } },
    ], '/wt/a')

    expect(files).toEqual(['src/b.ts', 'src/c.ts'])
  })

  it('does not count reading a file as touching it', () => {
    // The question this answers is what is different now.
    expect(filesTouched([{ toolName: 'Read', input: { file_path: '/wt/a/x.ts' } }], '/wt/a')).toEqual([])
  })

  it('does not count a shell command as a file', () => {
    expect(filesTouched([{ toolName: 'Bash', input: { command: 'rm -rf /' } }])).toEqual([])
  })
})
