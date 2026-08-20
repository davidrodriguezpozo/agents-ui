import { describe, expect, it } from 'vitest'
import { COMMANDS, completions, filterFrom, parseCommand } from '../commandLine'

describe('parseCommand', () => {
  it('is quiet about an empty line', () => {
    expect(parseCommand('')).toEqual({})
    expect(parseCommand(':  ')).toEqual({})
  })

  it('starts a session on the rest of the line', () => {
    expect(parseCommand(':new fix the flaky test')).toEqual({
      command: { kind: 'new', prompt: 'fix the flaky test' },
    })
    expect(parseCommand('new').error).toContain('What should')
  })

  it('filters the rail, in ids or in words', () => {
    expect(parseCommand(':only prs')).toEqual({ command: { kind: 'filter', filter: 'pull' } })
    expect(parseCommand(':only daily')).toEqual({ command: { kind: 'filter', filter: 'ritual' } })
    expect(parseCommand(':only needs-you')).toEqual({ command: { kind: 'filter', filter: 'needs-you' } })
    expect(parseCommand(':only nonsense').error).toContain('Nothing called nonsense')
  })

  it('takes no argument to mean no project, which is a real answer', () => {
    expect(parseCommand(':project')).toEqual({ command: { kind: 'project', path: null } })
    expect(parseCommand(':project ~/code/thing')).toEqual({
      command: { kind: 'project', path: '~/code/thing' },
    })
  })

  it('checks a trust level rather than passing one through', () => {
    expect(parseCommand(':trust full')).toEqual({ command: { kind: 'trust', level: 'full' } })
    expect(parseCommand(':trust everything').error).toContain('readonly, edits, full')
  })

  it('carries --override on a merge and nothing else', () => {
    expect(parseCommand(':merge')).toEqual({ command: { kind: 'merge', override: false } })
    expect(parseCommand(':merge --override')).toEqual({ command: { kind: 'merge', override: true } })
  })

  it('answers to the spellings vim taught people', () => {
    expect(parseCommand(':q')).toEqual({ command: { kind: 'quit' } })
    expect(parseCommand(':e')).toEqual({ command: { kind: 'editor' } })
    expect(parseCommand(':answer')).toEqual({ command: { kind: 'queue' } })
    expect(parseCommand(':wall')).toEqual({ command: { kind: 'fleet' } })
    expect(parseCommand(':find flaky')).toEqual({ command: { kind: 'search', query: 'flaky' } })
  })

  it('says what it does not know, rather than doing something else', () => {
    expect(parseCommand(':wq').error).toContain('Not a command: wq')
  })

  it('has a branch for everything :help offers', () => {
    // The list and the parser are the same fact told twice; this is the test
    // that keeps them one.
    for (const item of COMMANDS) {
      const line = item.args ? `${item.name} x` : item.name
      const parsed = parseCommand(line)
      expect(parsed.command || parsed.error, item.name).toBeTruthy()
      if (item.name !== 'trust' && item.name !== 'only') {
        expect(parsed.command, `${item.name} should parse`).toBeTruthy()
      }
    }
  })
})

describe('completions', () => {
  it('offers what could still be typed, and nothing once there is an argument', () => {
    expect(completions(':m')).toEqual(['merge'])
    expect(completions(':p')).toEqual(['project', 'pr'])
    expect(completions(':merge --over')).toEqual([])
    expect(completions(':').length).toBe(COMMANDS.length)
  })
})

describe('filterFrom', () => {
  it('is the same answer for `:only` and for `--only`', () => {
    expect(filterFrom('elsewhere')).toBe('inbox')
    expect(filterFrom('Needs You')).toBe('needs-you')
    expect(filterFrom('')).toBeNull()
  })
})
