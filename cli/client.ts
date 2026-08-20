/**
 * Talking to the server the browser talks to.
 *
 * The terminal app is a second client of the same API, not a second
 * implementation of the app: every list it shows and every action it takes is
 * an endpoint under `server/api` that the web UI also uses. That is the whole
 * reason a port is affordable — sessions, rituals, permissions and runs already
 * live behind HTTP, so what is left is drawing them.
 *
 * Nothing here needs a token. `server/middleware/sameOrigin.ts` lets a request
 * with no `Origin` and no `Sec-Fetch-Site` through on purpose: that is curl, an
 * editor extension, or this — another program already running as you, which is
 * the trust boundary the app has always had. The check it does *not* waive is
 * the host one, so this must address the server as loopback.
 */

export interface StudioError extends Error {
  status?: number
  data?: unknown
}

/** How long a plain request may take before it is treated as a failure. */
const REQUEST_TIMEOUT_MS = 30_000

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  signal?: AbortSignal
  /** Some endpoints — running the checks, composing a review — are slow by nature. */
  timeoutMs?: number
}

export class StudioClient {
  /** The project the next request should be scoped to. Views write this. */
  projectDirValue: string | null = null

  constructor(
    readonly baseUrl: string,
    /**
     * Read fresh on every request rather than captured, because switching
     * project is a thing you do while the app is open and every scoped endpoint
     * reads this header. See `server/utils/scope.ts`.
     */
    private readonly projectDir: () => string | null = () => this.projectDirValue,
  ) {}

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path, this.baseUrl)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }
    return url.toString()
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' }
    const dir = this.projectDir()
    if (dir) headers['x-project-dir'] = dir
    return headers
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query, signal, timeoutMs = REQUEST_TIMEOUT_MS } = options

    // Composed rather than chosen, so a caller's own abort still wins while a
    // request that hangs forever cannot wedge the pane that asked for it.
    const timeout = timeoutSignal(timeoutMs)
    const composed = signal ? composeSignals(signal, timeout) : timeout

    const response = await fetch(this.url(path, query), {
      method,
      signal: composed,
      headers: {
        ...this.headers(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

    if (!response.ok) throw await asError(response)

    if (response.status === 204) return undefined as T
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /**
   * Follow one of the server's event streams.
   *
   * Runs, terminals and notifications are all server-sent events in the same
   * `data: {json}\n\n` shape, so one reader serves all three. Yields frames
   * until the stream ends or the caller aborts — an abort surfaces as a normal
   * return rather than a throw, because every caller here aborts on purpose
   * when a pane closes.
   */
  async *events(
    path: string,
    options: { query?: RequestOptions['query']; signal?: AbortSignal } = {},
  ): AsyncGenerator<Record<string, unknown>> {
    const response = await fetch(this.url(path, options.query), {
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal: options.signal,
    })

    if (!response.ok) throw await asError(response)
    if (!response.body) return

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // The tail is whatever arrived without its newline yet — the next chunk
        // finishes it. Parsing it now is how a stream loses every frame that
        // happens to straddle a packet boundary.
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            yield JSON.parse(line.slice(6)) as Record<string, unknown>
          } catch {
            // A malformed frame is not worth tearing the stream down for.
          }
        }
      }
    } catch (error) {
      // The pane went away. Everything else is a real failure worth reporting.
      if (!isAbort(error)) throw error
    } finally {
      reader.cancel().catch(() => {})
    }
  }
}

export function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * `AbortSignal.timeout` arrived in Node 18.17; `AbortSignal.any` in 20.3. The
 * package promises 18, so both are built by hand rather than assumed.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  timer.unref?.()
  return controller.signal
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b])
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (a.aborted || b.aborted) {
    controller.abort()
    return controller.signal
  }
  a.addEventListener('abort', abort, { once: true })
  b.addEventListener('abort', abort, { once: true })
  return controller.signal
}

/**
 * Turn a failed response into something `errorMessage` can read.
 *
 * The server says what went wrong in the body — `createError({ data: { message } })`
 * — and the status line does not. Attaching the parsed body as `data` is what
 * lets the shared helper in `app/utils/errors.ts` find the sentence a person
 * should see rather than falling back to "500 Internal Server Error".
 */
async function asError(response: Response): Promise<StudioError> {
  let data: unknown
  try {
    data = JSON.parse(await response.text())
  } catch {
    data = undefined
  }

  const error = new Error(`${response.status} ${response.statusText}`) as StudioError
  error.status = response.status
  error.data = data
  return error
}
