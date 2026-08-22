import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { authority, probeHost, resolveUpstreamHost } from '../server/utils/previewProxy'

/**
 * Which address the preview proxy speaks to.
 *
 * The bug this covers was on a real machine: `nuxt dev` bound its HTTP server to
 * `::1` and Vite bound its HMR WebSocket to the wildcard address, both on one
 * port. Every preview URL was a hard-coded `127.0.0.1`, so the iframe reached
 * the WebSocket server and rendered its `426 Upgrade Required` instead of the
 * project.
 */

const open: Server[] = []

/** A server on one address that always answers with `status`. */
function serve(address: string, port: number, status: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' })
      res.end(status === 426 ? 'Upgrade Required' : 'the project')
    })
    server.on('error', reject)
    server.listen(port, address, () => {
      open.push(server)
      resolve(server)
    })
  })
}

/** A port nothing is on — asked for, then given back. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('no port'))))
    })
  })
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(s => new Promise<void>(done => s.close(() => done()))))
})

describe('authority', () => {
  it('brackets IPv6 and leaves IPv4 alone', () => {
    expect(authority('::1', 3000)).toBe('[::1]:3000')
    expect(authority('127.0.0.1', 3000)).toBe('127.0.0.1:3000')
    expect(authority('localhost', 3000)).toBe('localhost:3000')
  })
})

describe('probeHost', () => {
  it('is the status when something answers', async () => {
    const port = await freePort()
    await serve('127.0.0.1', port, 200)
    expect(await probeHost('127.0.0.1', port)).toBe(200)
  })

  it('is null when nothing is listening', async () => {
    expect(await probeHost('127.0.0.1', await freePort())).toBeNull()
  })
})

describe('resolveUpstreamHost', () => {
  it('picks the family serving the app over the one demanding an upgrade', async () => {
    const port = await freePort()
    await serve('::1', port, 200)
    await serve('0.0.0.0', port, 426)

    expect(await resolveUpstreamHost(port)).toBe('::1')
  })

  it('picks IPv4 when that is where the app is', async () => {
    const port = await freePort()
    await serve('127.0.0.1', port, 200)

    expect(await resolveUpstreamHost(port)).toBe('127.0.0.1')
  })

  it('keeps whichever answered when both only want an upgrade', async () => {
    const port = await freePort()
    await serve('::1', port, 426)

    expect(await resolveUpstreamHost(port)).toBe('::1')
  })

  it('falls back to IPv4 when nothing answers at all', async () => {
    expect(await resolveUpstreamHost(await freePort())).toBe('127.0.0.1')
  })
})
