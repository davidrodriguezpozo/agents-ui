import { describe, expect, it } from 'vitest'
import {
  allowedHostsFromEnv,
  checkOrigin,
  hostIsAllowed,
  isTrustedHostname,
} from '../server/utils/sameOrigin'

/**
 * The app has no authentication and runs shell commands as you. Before this
 * existed, a cross-origin form post set an arbitrary check command and the
 * next session turn ran it — proven end to end, `id` written to a file as the
 * logged-in user.
 *
 * So the case that matters in every test below is the one where a *web page*
 * you did not write asks this server to do something.
 */

const LOCAL = 'localhost:3000'

describe('isTrustedHostname', () => {
  it('trusts loopback by name', () => {
    expect(isTrustedHostname('localhost')).toBe(true)
    expect(isTrustedHostname('LOCALHOST')).toBe(true)
    expect(isTrustedHostname('app.localhost')).toBe(true)
    expect(isTrustedHostname('::1')).toBe(true)
  })

  it('trusts literal addresses, which rebinding cannot use', () => {
    // Reaching this from a phone on the LAN means typing an address, and an
    // attacker cannot re-point one — rebinding needs a name.
    expect(isTrustedHostname('127.0.0.1')).toBe(true)
    expect(isTrustedHostname('192.168.1.5')).toBe(true)
    expect(isTrustedHostname('10.0.0.42')).toBe(true)
  })

  it('refuses names it does not know', () => {
    expect(isTrustedHostname('evil.example')).toBe(false)
    expect(isTrustedHostname('localhost.evil.example')).toBe(false)
    expect(isTrustedHostname('notlocalhost')).toBe(false)
    expect(isTrustedHostname('')).toBe(false)
  })

  it('is not fooled by an address-shaped name', () => {
    expect(isTrustedHostname('999.999.999.999')).toBe(false)
    expect(isTrustedHostname('127.0.0.1.evil.example')).toBe(false)
  })
})

describe('hostIsAllowed', () => {
  it('ignores the port', () => {
    expect(hostIsAllowed('localhost:3000', [])).toBe(true)
    expect(hostIsAllowed('127.0.0.1:3310', [])).toBe(true)
  })

  it('accepts a host the person named themselves', () => {
    expect(hostIsAllowed('studio.my-tunnel.dev', ['studio.my-tunnel.dev'])).toBe(true)
  })

  it('refuses a missing Host outright', () => {
    expect(hostIsAllowed(undefined, [])).toBe(false)
  })
})

describe('allowedHostsFromEnv', () => {
  it('reads a comma-separated list, tolerating spacing and case', () => {
    expect(allowedHostsFromEnv(' A.example , b.example ')).toEqual(['a.example', 'b.example'])
  })

  it('is empty when unset', () => {
    expect(allowedHostsFromEnv(undefined)).toEqual([])
    expect(allowedHostsFromEnv('')).toEqual([])
  })
})

describe('checkOrigin — the attack this exists for', () => {
  it('blocks a cross-site form post, which needs no CORS to be sent', () => {
    const verdict = checkOrigin({
      method: 'POST',
      host: LOCAL,
      origin: 'https://evil.example',
      secFetchSite: 'cross-site',
    })

    expect(verdict.allowed).toBe(false)
  })

  it('blocks it even when the browser sends no Sec-Fetch-Site', () => {
    const verdict = checkOrigin({ method: 'POST', host: LOCAL, origin: 'https://evil.example' })
    expect(verdict.allowed).toBe(false)
  })

  it('blocks a rebinding attempt by refusing the host outright', () => {
    // Once a name the attacker controls resolves to 127.0.0.1, their page is
    // genuinely same-origin — so Origin alone would wave this through.
    const verdict = checkOrigin({
      method: 'GET',
      host: 'evil.example',
      origin: 'http://evil.example',
      secFetchSite: 'same-origin',
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toContain('does not answer to the host')
  })

  it('blocks a rebinding read, not just a write', () => {
    expect(checkOrigin({ method: 'GET', host: 'evil.example' }).allowed).toBe(false)
  })
})

describe('checkOrigin — what must keep working', () => {
  it('allows the app\'s own requests', () => {
    expect(checkOrigin({
      method: 'POST',
      host: LOCAL,
      origin: 'http://localhost:3000',
      secFetchSite: 'same-origin',
    }).allowed).toBe(true)
  })

  it('allows a typed address or a bookmark', () => {
    expect(checkOrigin({ method: 'GET', host: LOCAL, secFetchSite: 'none' }).allowed).toBe(true)
  })

  it('allows another program on this machine', () => {
    // curl, a script, an editor extension: already running as you, which is
    // the trust boundary this app has always had. A web page cannot omit
    // these headers, so nothing is opened up by letting these through.
    expect(checkOrigin({ method: 'POST', host: LOCAL }).allowed).toBe(true)
  })

  it('allows a phone on the LAN reaching it by address', () => {
    expect(checkOrigin({
      method: 'POST',
      host: '192.168.1.5:3000',
      origin: 'http://192.168.1.5:3000',
      secFetchSite: 'same-origin',
    }).allowed).toBe(true)
  })

  it('allows reads regardless of where they came from, once the host is fine', () => {
    // A GET cannot change anything, and blocking these would break opening a
    // link to a session from somewhere else.
    expect(checkOrigin({
      method: 'GET',
      host: LOCAL,
      origin: 'https://github.com',
      secFetchSite: 'cross-site',
    }).allowed).toBe(true)
  })

  it('trusts Sec-Fetch-Site over a mismatched Origin', () => {
    // Only the browser sets Sec-Fetch-Site, so when it says same-origin that
    // settles it.
    expect(checkOrigin({
      method: 'POST',
      host: LOCAL,
      origin: 'http://127.0.0.1:3000',
      secFetchSite: 'same-origin',
    }).allowed).toBe(true)
  })

  it('refuses an Origin it cannot parse rather than guessing', () => {
    expect(checkOrigin({ method: 'POST', host: LOCAL, origin: 'not a url' }).allowed).toBe(false)
  })
})
