import { describe, expect, it } from 'vitest'
import { looksSandboxed, refusedHostsIn } from '../server/utils/sandboxViolations'

/**
 * Every string in the first block came back from a real sandboxed run against
 * a throwaway repository, not from documentation. That matters: the two denial
 * mechanisms here are not the ones you would guess, and a detector written from
 * the docs alone would have matched the proxy refusal and silently missed every
 * Node-based failure.
 */

const REAL = {
  curl: 'Exit code 56\ncurl: (56) CONNECT tunnel failed, response 403',
  git: "fatal: unable to access 'https://github.com/anthropics/claude-code/': CONNECT tunnel failed, response 403",
  nodeFetch: 'ERR fetch failed getaddrinfo ENOTFOUND registry.npmjs.org',
  /**
   * The one that matters most, and the one nothing predicted: run through this
   * app rather than a bare SDK call, the same blocked host produces no refusal
   * at all. The packets are dropped and curl eventually gives up.
   */
  timeout: 'Exit code 28\nFAILED: curl curl: (28) Connection timed out after 10005 milliseconds',
}

describe('what a real blocked run said', () => {
  it('names the host git was refused, from the URL in the message', () => {
    expect(refusedHostsIn('git ls-remote https://github.com/anthropics/claude-code', REAL.git))
      .toEqual(['github.com'])
  })

  it('names the host node was refused, which fails at DNS rather than the proxy', () => {
    // Node's fetch resolves for itself, so it never reaches the proxy and never
    // produces a 403. Matching only the 403 would miss this entirely.
    expect(refusedHostsIn('node -e "fetch(...)"', REAL.nodeFetch)).toEqual(['registry.npmjs.org'])
  })

  it('falls back to the command when the refusal named nothing', () => {
    // curl says only that the tunnel failed. The host is in what was run.
    expect(refusedHostsIn('curl -sS https://example.com', REAL.curl)).toEqual(['example.com'])
  })

  it('names the host a dropped connection was about, from the command', () => {
    // This is what the app's own runs actually produce. A detector built only
    // from the proxy refusal would have found nothing here — which is to say,
    // nothing in the case users will overwhelmingly hit.
    expect(refusedHostsIn('curl -sS --max-time 10 https://registry.npmjs.org/', REAL.timeout))
      .toEqual(['registry.npmjs.org'])
  })

  it('recognises all four as sandbox denials', () => {
    for (const output of Object.values(REAL)) {
      expect(looksSandboxed(output)).toBe(true)
    }
  })
})

/**
 * A timeout is the one signature that is genuinely ambiguous — it is also what
 * a slow host says. The allowlist is what disambiguates it: a host this project
 * already permits was not refused by anything.
 */
describe('not blaming the sandbox for the network', () => {
  it('says nothing about a host the project already allows', () => {
    expect(refusedHostsIn(
      'curl https://registry.npmjs.org/',
      REAL.timeout,
      { allowed: ['registry.npmjs.org'] },
    )).toEqual([])
  })

  it('ignores the allowlist for an unambiguous refusal it still reports', () => {
    // A 403 from the proxy is not the network being slow, so an allowed host
    // producing one is worth surfacing rather than swallowing... but the host
    // was allowed, so there is nothing to suggest. Empty either way — what
    // matters is that it does not claim a *different* host was refused.
    expect(refusedHostsIn('git fetch', REAL.git, { allowed: ['github.com'] })).toEqual([])
  })

  it('still reports the hosts that are not allowed', () => {
    expect(refusedHostsIn(
      'curl https://api.example.com/',
      REAL.timeout,
      { allowed: ['registry.npmjs.org'] },
    )).toEqual(['api.example.com'])
  })
})

describe('other shapes of the same denial', () => {
  it('reads an older git proxy refusal', () => {
    const output = "fatal: unable to access 'https://gitlab.com/x/y': "
      + 'Received HTTP code 403 from proxy after CONNECT'
    expect(refusedHostsIn('git fetch', output)).toEqual(['gitlab.com'])
  })

  it('reads the npm client through a proxy agent', () => {
    const output = 'Error: tunneling socket could not be established, statusCode=403'
    expect(refusedHostsIn('npm install https://registry.npmjs.org/x', output))
      .toEqual(['registry.npmjs.org'])
  })

  it('collects every host when a command was refused more than one', () => {
    const output = 'getaddrinfo ENOTFOUND api.one.com\ngetaddrinfo ENOTFOUND api.two.com'
    expect(refusedHostsIn('node run.js', output)).toEqual(['api.one.com', 'api.two.com'])
  })

  it('says the same host once, however many times it failed', () => {
    const output = 'getaddrinfo ENOTFOUND registry.npmjs.org\ngetaddrinfo EAI_AGAIN registry.npmjs.org'
    expect(refusedHostsIn('npm ci', output)).toEqual(['registry.npmjs.org'])
  })
})

describe('what it must not claim', () => {
  it('says nothing about ordinary output', () => {
    expect(refusedHostsIn('npm test', '42 passing\n0 failing')).toEqual([])
    expect(looksSandboxed('42 passing')).toBe(false)
  })

  it('does not read an ordinary non-zero exit as a denial', () => {
    // A failing test suite mentions hosts all the time. Only the denial
    // signatures count, never the mere presence of a URL.
    expect(refusedHostsIn('npm test', 'FAIL: expected https://api.example.com to respond'))
      .toEqual([])
  })

  it('does not suggest allowlisting somewhere local', () => {
    // `allowLocalBinding` already covers these, so offering them would be
    // advice that fixes nothing.
    const output = 'getaddrinfo ENOTFOUND localhost'
    expect(refusedHostsIn('curl http://localhost:3000', output)).toEqual([])
  })

  it('ignores a bare name with no dot in it', () => {
    expect(refusedHostsIn('curl http://db', 'getaddrinfo ENOTFOUND db')).toEqual([])
  })

  it('survives being asked about nothing at all', () => {
    expect(refusedHostsIn('', '')).toEqual([])
    expect(looksSandboxed('')).toBe(false)
  })
})

describe('being asked the same thing twice', () => {
  it('answers a repeated question identically', () => {
    // The patterns are module-level and global, so a stale lastIndex would make
    // the second call disagree with the first.
    expect(looksSandboxed(REAL.nodeFetch)).toBe(true)
    expect(looksSandboxed(REAL.nodeFetch)).toBe(true)

    expect(refusedHostsIn('npm ci', REAL.nodeFetch)).toEqual(['registry.npmjs.org'])
    expect(refusedHostsIn('npm ci', REAL.nodeFetch)).toEqual(['registry.npmjs.org'])
  })
})

/**
 * The false positives a code review found.
 *
 * `refusedHostsIn` runs over the text of *every* tool result whenever the
 * sandbox is on, so a pattern matching ordinary prose reports a run that fully
 * succeeded as sandbox-blocked. That is not cosmetic: `blocked` counts against
 * a ritual, skips its retry, and feeds the three-strike auto-disable.
 */
describe('not blaming the sandbox for ordinary output', () => {
  const cases: [string, string][] = [
    ['a log file being read', 'INFO  Connection timed out talking to the database, retrying'],
    ['a commit message', 'commit a1b2c3\n\n    fix: handle Connection timed out from upstream'],
    ['a test asserting on the words', 'ok 4 - retries when the server says Failed to connect to it'],
    ['prose mentioning a URL', 'See https://docs.example.com for why Connection timed out happens'],
  ]

  for (const [what, output] of cases) {
    it(`says nothing about ${what}`, () => {
      expect(refusedHostsIn('npm test', output)).toEqual([])
      expect(looksSandboxed(output)).toBe(false)
    })
  }

  it('does not harvest every URL in the output of a real failure', () => {
    // A run refused one host was reported as refused all three, none of which
    // it had asked for. What the command pointed at is the real evidence.
    const output = 'curl: (28) Connection timed out\nsee https://a.example.com and https://b.example.com'

    expect(refusedHostsIn('curl -sS https://wanted.example.com', output))
      .toEqual(['wanted.example.com'])
  })

  it('still recognises every real denial it was built from', () => {
    for (const output of Object.values(REAL)) {
      expect(looksSandboxed(output), output).toBe(true)
    }
  })
})
