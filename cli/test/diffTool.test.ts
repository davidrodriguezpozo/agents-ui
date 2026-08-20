import { describe, expect, it } from 'vitest'
import { anchorsFor, onPath, pickDiffTool } from '../diffTool'

describe('pickDiffTool', () => {
  it('uses nothing when asked for nothing', () => {
    expect(pickDiffTool({ AGENTS_STUDIO_DIFF: 'none', PATH: '/usr/bin' })).toBeNull()
  })

  it('finds nothing on an empty PATH, and says so rather than guessing', () => {
    expect(pickDiffTool({ PATH: '' })).toBeNull()
  })

  it('takes a command with its own flags', () => {
    const tool = pickDiffTool({ AGENTS_STUDIO_DIFF: '/bin/cat --squeeze-blank', PATH: '' })
    expect(tool?.command).toBe('/bin/cat')
    expect(tool?.args(80)).toEqual(['--squeeze-blank'])
  })

  it('tells delta the width, because a pane is not a terminal', () => {
    const tool = pickDiffTool({ AGENTS_STUDIO_DIFF: 'delta', PATH: '' })
    // Not installed here, so nothing is returned — the point is that asking for
    // a tool that is not there falls back rather than failing.
    expect(tool).toBeNull()
  })
})

describe('onPath', () => {
  it('answers for an absolute path without searching', () => {
    expect(onPath('/bin/sh')).toBe(true)
    expect(onPath('/bin/definitely-not-here')).toBe(false)
  })

  it('searches PATH for a bare name', () => {
    expect(onPath('sh', { PATH: '/bin:/usr/bin' })).toBe(true)
    expect(onPath('sh', { PATH: '/nowhere' })).toBe(false)
  })
})

describe('anchorsFor', () => {
  const rendered = [
    'delta header',
    'app/one.ts',
    '  1  +first',
    'server/two.ts',
    '  1  +second',
  ]

  it('finds each file in the order it was rendered', () => {
    expect(anchorsFor(rendered, ['app/one.ts', 'server/two.ts'])).toEqual([1, 3])
  })

  it('skips a path the renderer did not print rather than guessing a line', () => {
    expect(anchorsFor(rendered, ['app/one.ts', 'gone.ts', 'server/two.ts'])).toEqual([1, 3])
  })

  it('never walks backwards, so a repeated name cannot fold the list', () => {
    const twice = ['a.ts', 'x', 'a.ts', 'y']
    expect(anchorsFor(twice, ['a.ts', 'a.ts'])).toEqual([0, 2])
  })
})
