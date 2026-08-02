import { describe, expect, it } from 'vitest'
import { pluginCommandInvocation } from '../server/utils/pluginScan'
import { localCommandInvocation } from '../server/utils/collect'
import { slugCandidates, slugToPath } from '../server/utils/commandPath'

describe('pluginCommandInvocation', () => {
  it('namespaces a root command under the plugin', () => {
    expect(pluginCommandInvocation('hd', 'debug.md')).toBe('/hd:debug')
  })

  it('namespaces a subdirectory command under the directory instead', () => {
    // This is the rule that makes hd ship both /hd:debug and /defender:pickup.
    expect(pluginCommandInvocation('hd', 'defender/pickup.md')).toBe('/defender:pickup')
  })

  it('joins deeper nesting with colons', () => {
    expect(pluginCommandInvocation('hd', 'a/b/c.md')).toBe('/a:b:c')
  })

  it('keeps hyphens in the command name', () => {
    expect(pluginCommandInvocation('hd', 'address-pr.md')).toBe('/hd:address-pr')
    expect(pluginCommandInvocation('hd', 'defender/cursor-bot.md')).toBe('/defender:cursor-bot')
  })
})

describe('localCommandInvocation', () => {
  it('leaves a root command unqualified', () => {
    expect(localCommandInvocation('', 'deploy')).toBe('/deploy')
  })

  it('namespaces by directory', () => {
    expect(localCommandInvocation('git', 'sync')).toBe('/git:sync')
    expect(localCommandInvocation('a/b', 'c')).toBe('/a:b:c')
  })
})

describe('slugToPath', () => {
  it('maps a root slug to a filename', () => {
    expect(slugToPath('deploy')).toEqual({ directory: '', filename: 'deploy.md' })
  })

  it('maps a namespaced slug back to its directory', () => {
    expect(slugToPath('git--sync')).toEqual({ directory: 'git', filename: 'sync.md' })
    expect(slugToPath('a--b--c')).toEqual({ directory: 'a/b', filename: 'c.md' })
  })

  it('round-trips every slug the scanner can produce', () => {
    const cases: { directory: string; name: string }[] = [
      { directory: '', name: 'deploy' },
      { directory: 'git', name: 'sync' },
      { directory: 'a/b', name: 'c' },
    ]

    for (const { directory, name } of cases) {
      const slug = directory ? `${directory.replace(/\//g, '--')}--${name}` : name
      expect(slugToPath(slug)).toEqual({ directory, filename: `${name}.md` })
    }
  })

})

describe('slugCandidates', () => {
  it('offers both readings of an ambiguous slug, deepest first', () => {
    // `commands/my--command.md` and `commands/my/command.md` produce the same
    // slug, so resolution has to try both against the filesystem.
    expect(slugCandidates('my--command')).toEqual([
      { directory: 'my', filename: 'command.md' },
      { directory: '', filename: 'my--command.md' },
    ])
  })

  it('enumerates every split of a deeply namespaced slug', () => {
    expect(slugCandidates('a--b--c')).toEqual([
      { directory: 'a/b', filename: 'c.md' },
      { directory: 'a', filename: 'b--c.md' },
      { directory: '', filename: 'a--b--c.md' },
    ])
  })

  it('returns a single reading when there is nothing to split', () => {
    expect(slugCandidates('deploy')).toEqual([{ directory: '', filename: 'deploy.md' }])
  })

  it('always includes the flat reading as a fallback', () => {
    for (const slug of ['git--sync', 'a--b--c', 'my--command']) {
      const flat = slugCandidates(slug).at(-1)
      expect(flat).toEqual({ directory: '', filename: `${slug}.md` })
    }
  })
})
