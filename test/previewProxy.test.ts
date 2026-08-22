import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PICKER_PATH } from '../server/utils/previewPicker'
import { rewriteLocation, startPreviewProxy, type PreviewProxy } from '../server/utils/previewProxy'

/**
 * The proxy is the only reason pointing at an element is possible at all, and
 * it sits in front of somebody's dev server — so the thing worth proving is
 * that it is invisible apart from the one script it adds. A stand-in dev server
 * on a kernel-chosen port stands in for the real one; nothing here touches a
 * session, a store or `CLAUDE_DIR`.
 *
 * This is as far as an unattended run can take the brief's by-hand step. The
 * click itself happens in a browser.
 */

let upstream: Server
let upstreamPort = 0
let proxy: PreviewProxy

const PAGE = '<html><head><title>App</title></head><body><button class="btn">Run it</button></body></html>'

beforeAll(async () => {
  upstream = createServer((req, res) => {
    if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' })
      res.end('.btn { color: red }')
      return
    }
    if (req.url === '/moved') {
      res.writeHead(302, { location: `http://127.0.0.1:${upstreamPort}/` })
      res.end()
      return
    }
    if (req.url === '/elsewhere') {
      res.writeHead(302, { location: 'https://example.com/docs' })
      res.end()
      return
    }
    if (req.url === '/echo' && req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ got: Buffer.concat(chunks).toString('utf-8') }))
      })
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  })

  await new Promise<void>((resolve, reject) => {
    upstream.on('error', reject)
    upstream.listen(0, '127.0.0.1', () => {
      const address = upstream.address()
      upstreamPort = typeof address === 'object' && address ? address.port : 0
      resolve()
    })
  })

  proxy = await startPreviewProxy(upstreamPort)
})

afterAll(async () => {
  proxy?.close()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
})

const through = (path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${proxy.port}${path}`, init)

describe('serving the dev server with the picker in it', () => {
  it('adds the script to an HTML page', async () => {
    const body = await (await through('/')).text()

    expect(body).toContain(`<script src="${PICKER_PATH}"`)
    expect(body).toContain('<button class="btn">Run it</button>')
  })

  it('corrects the length, so the browser reads the whole page', async () => {
    const answer = await through('/')
    const body = await answer.text()

    expect(answer.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
  })

  it('serves the script it added', async () => {
    const answer = await through(PICKER_PATH)

    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('javascript')
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.text()).toContain('agents-ui-picker')
  })

  it('leaves anything that is not HTML exactly as it came', async () => {
    const answer = await through('/style.css')

    expect(await answer.text()).toBe('.btn { color: red }')
    expect(answer.headers.get('content-type')).toBe('text/css')
  })

  it('passes a request body through', async () => {
    const answer = await through('/echo', { method: 'POST', body: 'hello' })

    expect(await answer.json()).toEqual({ got: 'hello' })
  })

  it('says which port did not answer when nothing is there', async () => {
    const dead = await startPreviewProxy(1)
    try {
      const answer = await fetch(`http://127.0.0.1:${dead.port}/`)

      expect(answer.status).toBe(502)
      expect(await answer.text()).toContain('port 1 did not answer')
    } finally {
      dead.close()
    }
  })
})

describe('keeping a redirect inside the proxy', () => {
  it('points the dev server\'s own port back at this one', () => {
    expect(rewriteLocation('http://127.0.0.1:5173/next', 5173, 4321))
      .toBe('http://127.0.0.1:4321/next')
    expect(rewriteLocation('http://localhost:5173/', 5173, 4321))
      .toBe('http://127.0.0.1:4321/')
    expect(rewriteLocation('//127.0.0.1:5173/x', 5173, 4321))
      .toBe('http://127.0.0.1:4321/x')
  })

  it('leaves a relative redirect alone — it already stays here', () => {
    expect(rewriteLocation('/login', 5173, 4321)).toBe('/login')
  })

  it('leaves somewhere else alone, port or no port', () => {
    expect(rewriteLocation('https://example.com/docs', 5173, 4321)).toBe('https://example.com/docs')
    expect(rewriteLocation('http://127.0.0.1:5174/x', 5173, 4321)).toBe('http://127.0.0.1:5174/x')
    // A port that merely starts with the target's digits is a different port.
    expect(rewriteLocation('http://127.0.0.1:51730/x', 5173, 4321)).toBe('http://127.0.0.1:51730/x')
  })

  it('has nothing to say about a response without one', () => {
    expect(rewriteLocation(undefined, 5173, 4321)).toBeUndefined()
  })

  it('rewrites it on the way through', async () => {
    const answer = await through('/moved', { redirect: 'manual' })

    expect(answer.headers.get('location')).toBe(`http://127.0.0.1:${proxy.port}/`)
  })

  it('lets a redirect off the dev server go where it says', async () => {
    const answer = await through('/elsewhere', { redirect: 'manual' })

    expect(answer.headers.get('location')).toBe('https://example.com/docs')
  })
})
