import { describe, expect, it } from 'vitest'
import {
  EXECUTABLE_ENV,
  findClaudeExecutable,
  installCandidates,
  platformPackages,
} from '../server/utils/claudeExecutable'

/**
 * This is the check that 0.5.1 and 0.5.2 needed and did not have.
 *
 * The SDK stopped shipping its CLI as JavaScript and started resolving a native
 * binary out of an optional dependency, which a vendored Nitro build does not
 * carry. Every run in an installed copy failed on "Native CLI binary for
 * darwin-arm64 not found" while a checkout — where that dependency is sitting in
 * node_modules — carried on working perfectly. So the case that matters here is
 * the one where the platform package cannot be resolved.
 */

const NO_PACKAGE = (specifier: string): string => {
  throw new Error(`Cannot find module '${specifier}'`)
}

describe('finding the binary a run is spawned from', () => {
  it('takes the platform package when it is there, as the SDK would have', () => {
    const found = findClaudeExecutable({
      platform: 'darwin',
      arch: 'arm64',
      env: {},
      resolvePackage: specifier => `/repo/node_modules/${specifier}`,
      isExecutable: path => path.endsWith('claude'),
    })

    expect(found).toBe('/repo/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude')
  })

  it('falls back to the Claude Code on the machine when the package is absent', () => {
    const found = findClaudeExecutable({
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '/usr/bin:/opt/homebrew/bin' },
      resolvePackage: NO_PACKAGE,
      isExecutable: path => path === '/opt/homebrew/bin/claude',
    })

    expect(found).toBe('/opt/homebrew/bin/claude')
  })

  it('finds the native installer, whose directory is rarely on a service PATH', () => {
    const found = findClaudeExecutable({
      platform: 'darwin',
      arch: 'arm64',
      env: { PATH: '/usr/bin' },
      home: '/home/dev',
      resolvePackage: NO_PACKAGE,
      isExecutable: path => path === '/home/dev/.local/bin/claude',
    })

    expect(found).toBe('/home/dev/.local/bin/claude')
  })

  it('reports nothing rather than guessing when there is no Claude Code at all', () => {
    const found = findClaudeExecutable({
      platform: 'linux',
      arch: 'x64',
      env: { PATH: '/usr/bin' },
      resolvePackage: NO_PACKAGE,
      isExecutable: () => false,
    })

    expect(found).toBeNull()
  })

  it('obeys an explicit override, and does not silently substitute another binary', () => {
    const lookup = {
      platform: 'darwin' as const,
      arch: 'arm64',
      env: { [EXECUTABLE_ENV]: '/opt/custom/claude', PATH: '/usr/bin' },
      resolvePackage: NO_PACKAGE,
    }

    expect(findClaudeExecutable({ ...lookup, isExecutable: p => p === '/opt/custom/claude' }))
      .toBe('/opt/custom/claude')
    // A path that was asked for and does not work is a mistake to hear about.
    expect(findClaudeExecutable({ ...lookup, isExecutable: p => p === '/usr/bin/claude' }))
      .toBeNull()
  })

  it('asks for the musl build first only where musl is what runs', () => {
    expect(platformPackages('linux', 'arm64', true)[0])
      .toBe('@anthropic-ai/claude-agent-sdk-linux-arm64-musl/claude')
    expect(platformPackages('linux', 'arm64', false)[0])
      .toBe('@anthropic-ai/claude-agent-sdk-linux-arm64/claude')
    // Both, either way round: a glibc binary on Alpine fails to launch, and the
    // reverse is just as true.
    expect(platformPackages('linux', 'arm64', false)).toHaveLength(2)
  })

  it('looks for claude.exe on Windows', () => {
    expect(platformPackages('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe'])
    // Only the name is asserted: path separators come from whichever platform
    // is running the test, and in production that is the platform being asked
    // about anyway.
    const candidates = installCandidates({ platform: 'win32', env: { PATH: 'C:\\bin' }, home: 'C:\\Users\\dev' })
    expect(candidates.length).toBeGreaterThan(0)
    expect(candidates.every(path => path.endsWith('claude.exe'))).toBe(true)
  })

  it('prefers PATH — what the user chose — over the fixed locations', () => {
    const candidates = installCandidates({
      platform: 'darwin',
      env: { PATH: '/first:/second' },
      home: '/home/dev',
    })

    expect(candidates.slice(0, 2)).toEqual(['/first/claude', '/second/claude'])
    expect(candidates).toContain('/home/dev/.local/bin/claude')
  })

  it('never offers a bare command name, which the SDK cannot check for', () => {
    const candidates = installCandidates({
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      home: '/home/dev',
    })

    expect(candidates.every(path => path.startsWith('/'))).toBe(true)
  })
})
