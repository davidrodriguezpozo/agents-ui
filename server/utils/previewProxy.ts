import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { connect } from 'node:net'
import { PICKER_PATH, injectPicker, isHtmlResponse, pickerScript } from './previewPicker'

/**
 * One hop in front of the session's dev server, so a script can be added to it.
 *
 * The preview iframe used to point straight at the dev server, and that is why
 * pointing at an element in it was impossible: the dev server is on its own port
 * and the app cannot reach into a different origin's document, nor ask a dev
 * server it did not write to serve an extra script. So this sits between them.
 * It mirrors the dev server's whole path space at its own root — which is the
 * point of a second port rather than a route under this app, because a project's
 * `/_nuxt/entry.js` has to stay `/_nuxt/entry.js` or nothing loads — and adds
 * one `<script>` tag to HTML responses. See `previewPicker.ts` for what the
 * script does.
 *
 * Everything else is passed through as it came: same method, same headers, same
 * body, same status. Two exceptions, both forced:
 *
 * - `accept-encoding: identity` upstream, because rewriting HTML means reading
 *   it, and a gzipped body is not readable without decompressing it. If a dev
 *   server compresses anyway the body is piped through untouched and the picker
 *   simply never answers — reported as unavailable rather than silently absent.
 * - `Location` headers that name the dev server's own port are rewritten to this
 *   one, or the first redirect would drop the page back out of the proxy.
 *
 * WebSocket upgrades are tunnelled raw, which is what keeps hot reload working
 * inside the preview. A `Content-Security-Policy` from the project is left
 * alone: it is the project's, and stripping it to make our script run would be
 * changing the thing under review. A page with one that blocks the script says
 * the picker is unavailable, which is true.
 *
 * It only ever fronts a port this app started for this session, and binds to
 * 127.0.0.1 like the dev server it fronts.
 */

/** Beyond this an HTML document is not a page, and buffering it is not free. */
const MAX_HTML = 4 * 1024 * 1024

export interface PreviewProxy {
  port: number
  close: () => void
}

/**
 * Point a `Location` back at the proxy.
 *
 * Only when it names the dev server's own port: a redirect to some other host
 * is the project's business and following it out of the proxy is correct.
 */
export function rewriteLocation(
  location: string | undefined,
  targetPort: number,
  proxyPort: number,
): string | undefined {
  if (!location) return location

  const from = new RegExp(`^(https?:)?//(127\\.0\\.0\\.1|localhost|\\[::1\\]):${targetPort}(?=/|$)`, 'i')
  return location.replace(from, `http://127.0.0.1:${proxyPort}`)
}

/**
 * Rebuild the request line and headers for a tunnelled upgrade.
 *
 * `http.request` cannot carry an upgrade, so the socket is spoken to directly
 * and the head has to be written by hand. `rawHeaders` rather than `headers`
 * keeps repeated headers repeated; only `host` is replaced, so the dev server
 * sees a request for itself.
 */
export function upgradeHead(req: IncomingMessage, targetPort: number): string {
  const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`]

  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]!
    const value = req.rawHeaders[i + 1] ?? ''
    lines.push(name.toLowerCase() === 'host' ? `Host: 127.0.0.1:${targetPort}` : `${name}: ${value}`)
  }

  return lines.join('\r\n') + '\r\n\r\n'
}

/**
 * Start one, on a port the kernel picks.
 *
 * Resolves once it is listening, so the caller can hand the port to the page in
 * the same answer that says the preview is starting.
 */
export function startPreviewProxy(targetPort: number): Promise<PreviewProxy> {
  const server: Server = createServer((req, res) => {
    if (req.url === PICKER_PATH) {
      const body = pickerScript()
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        // The script changes with this app, not with the project, and a stale
        // copy in the iframe's cache would be a picker that does not answer.
        'cache-control': 'no-store',
      })
      res.end(body)
      return
    }

    const headers = { ...req.headers, host: `127.0.0.1:${targetPort}`, 'accept-encoding': 'identity' }
    delete headers['if-none-match']
    delete headers['if-modified-since']

    const upstream = httpRequest(
      { host: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers },
      (answer) => {
        const out = { ...answer.headers }
        const moved = rewriteLocation(answer.headers.location, targetPort, proxyPort(server))
        if (moved !== undefined) out.location = moved

        const rewritable = isHtmlResponse(answer.headers['content-type'])
          && !answer.headers['content-encoding']

        if (!rewritable) {
          res.writeHead(answer.statusCode ?? 502, out)
          answer.pipe(res)
          return
        }

        // Buffered rather than streamed, because `</head>` can straddle two
        // chunks and a tag written across the boundary is a broken document.
        const chunks: Buffer[] = []
        let size = 0
        let overflowed = false

        answer.on('data', (chunk: Buffer) => {
          if (overflowed) return
          size += chunk.length
          if (size > MAX_HTML) {
            overflowed = true
            res.writeHead(answer.statusCode ?? 200, out)
            for (const held of chunks) res.write(held)
            res.write(chunk)
            answer.pipe(res)
            return
          }
          chunks.push(chunk)
        })

        answer.on('end', () => {
          if (overflowed) return
          const html = injectPicker(Buffer.concat(chunks).toString('utf-8'))
          delete out['content-length']
          delete out['transfer-encoding']
          res.writeHead(answer.statusCode ?? 200, {
            ...out,
            'content-length': Buffer.byteLength(html),
          })
          res.end(html)
        })

        answer.on('error', () => res.destroy())
      },
    )

    upstream.on('error', (e: Error) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`The dev server on port ${targetPort} did not answer: ${e.message}\n`)
    })

    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  })

  server.on('upgrade', (req, socket, head) => {
    const tunnel = connect({ port: targetPort, host: '127.0.0.1' }, () => {
      tunnel.write(upgradeHead(req, targetPort))
      if (head?.length) tunnel.write(head)
      tunnel.pipe(socket)
      socket.pipe(tunnel)
    })

    tunnel.on('error', () => socket.destroy())
    socket.on('error', () => tunnel.destroy())
  })

  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = proxyPort(server)
      if (!port) {
        server.close()
        reject(new Error('the preview proxy got no port'))
        return
      }
      resolve({
        port,
        close: () => {
          try {
            // Connections first: an iframe holds a keep-alive socket open, and
            // `close()` alone waits for it, which is forever.
            server.closeAllConnections?.()
            server.close()
          } catch {
            // Already closed, which is the outcome asked for.
          }
        },
      })
    })
  })
}

function proxyPort(server: Server): number {
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}
