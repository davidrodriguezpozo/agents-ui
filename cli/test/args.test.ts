import { describe, expect, it } from 'vitest'
import { parseArgs, usage } from '../args'

describe('parseArgs', () => {
  it('defaults to the terminal app on port 3000', () => {
    const invocation = parseArgs([], {})
    expect(invocation.command).toBe('tui')
    expect(invocation.port).toBe(3000)
    expect(invocation.errors).toEqual([])
  })

  it('prefers --port over PORT, in either spelling', () => {
    expect(parseArgs(['tui', '--port', '3001'], {}).port).toBe(3001)
    expect(parseArgs(['--port=4000'], { PORT: '3001' }).port).toBe(4000)
    expect(parseArgs(['-p', '9'], {}).port).toBe(9)
    expect(parseArgs([], { PORT: '3002' }).port).toBe(3002)
  })

  it('says so rather than guessing, for a port that is not one', () => {
    const invocation = parseArgs(['--port', 'nope'], {})
    expect(invocation.errors).toEqual(['nope is not a port.'])
    // Still filled in, so a caller that ignores errors cannot read undefined.
    expect(invocation.port).toBe(3000)
  })

  it('refuses an option it does not know', () => {
    expect(parseArgs(['work', '--jsonn'], {}).errors).toEqual(['No such option: --jsonn'])
  })

  it('opens a view, and refuses one that does not exist', () => {
    expect(parseArgs(['tui', '--view', 'fleet'], {}).view).toBe('fleet')
    expect(parseArgs(['tui', '--view', 'wall'], {}).errors[0]).toContain('No view called wall')
  })

  it('takes a session id as the thing to open, and complains about a second one', () => {
    expect(parseArgs(['tui', 's-1'], {}).session).toBe('s-1')
    expect(parseArgs(['tui', 's-1', 's-2'], {}).errors[0]).toContain('Too many arguments')
  })

  it('reads an unquoted instruction as one instruction', () => {
    const invocation = parseArgs(['new', 'fix', 'the', 'flaky', 'test'], {})
    expect(invocation.command).toBe('new')
    expect(invocation.prompt).toBe('fix the flaky test')
    expect(invocation.errors).toEqual([])
  })

  it('asks what to work on when `new` is given nothing', () => {
    expect(parseArgs(['new'], {}).errors).toEqual(['What should the session work on?'])
  })

  it('rejects a stray positional on a list command', () => {
    expect(parseArgs(['work', 'please'], {}).errors).toEqual(['Unexpected argument: please'])
  })

  it('carries the flags every command shares', () => {
    const invocation = parseArgs(['fleet', '--json', '-q', '--no-bell', '--project', '/repo'], {})
    expect(invocation).toMatchObject({
      command: 'fleet',
      json: true,
      quiet: true,
      bell: false,
      project: '/repo',
    })
  })

  it('turns --help into the help command wherever it appears', () => {
    expect(parseArgs(['work', '--help'], {}).command).toBe('help')
    expect(usage()).toContain('agents-studio work')
  })
})
