/**
 * Working out which host a sandboxed run was refused.
 *
 * The SDK sandboxes network access but reports nothing structured about what
 * it blocked — the denial only ever appears as text, in whatever words the
 * program that hit it happens to use. So this reads that text.
 *
 * Every pattern below was taken from a real blocked run rather than from
 * documentation, because the two mechanisms involved are not obvious and a
 * plausible-looking guess would have missed most of them:
 *
 * - Programs that honour `HTTPS_PROXY` reach the sandbox's proxy, which
 *   refuses the tunnel. `curl` says `CONNECT tunnel failed, response 403`;
 *   `git` says the same thing with the URL in front of it.
 * - Programs that resolve DNS themselves never get that far and simply fail to
 *   resolve. Node's `fetch` says `getaddrinfo ENOTFOUND registry.npmjs.org`.
 *
 * A detector matching only the first kind would miss every Node-based failure,
 * which is most of what a JavaScript project actually hits.
 *
 * The second awkwardness: the proxy refusal does not name the host. `curl`
 * blocked from example.com says nothing about example.com at all — the host has
 * to come from the URL in the message, or failing that from the command that
 * was run.
 */

/** The proxy refused to open a tunnel. Unambiguous: this is the sandbox. */
const PROXY_REFUSALS = [
  // curl, and git (which prefixes it with the URL it wanted)
  /CONNECT tunnel failed, response 403/i,
  // older git against a proxy
  /Received HTTP code 403 from proxy after CONNECT/i,
  // node's https-proxy-agent and the npm client
  /tunneling socket could not be established[^\n]*?statusCode=403/i,
]

/**
 * A name that would not resolve. Only meaningful when the sandbox is on — the
 * same text is what an offline laptop says — which is why nothing here decides
 * on its own that a run was sandboxed.
 */
const DNS_REFUSAL = /getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)\s+([A-Za-z0-9._-]+)/gi

/**
 * The connection went nowhere and eventually gave up.
 *
 * This one was a surprise, and it is the shape that matters most: run through
 * this app's own configuration rather than a bare SDK call, a blocked host does
 * **not** come back as a proxy refusal. The packets are simply dropped, and
 * `curl` reports `(28) Connection timed out` — the same thing it would say
 * about a host that is merely slow.
 *
 * So this signature cannot stand on its own the way a 403 can. It is used only
 * for hosts the project has *not* allowed, on the reasoning that a host you
 * already allowed and still could not reach is a network problem rather than a
 * sandbox one — and calling that a refusal would mark a ritual `blocked` and
 * rob it of the retry a transient failure deserves.
 */
const UNREACHABLE = [
  /curl:\s*\(28\)/i,
  /Connection timed out/i,
  /Failed to connect to /i,
  /Could ?n[o']?t connect to server/i,
  /Network is unreachable/i,
  /connect\s+(?:ETIMEDOUT|ECONNREFUSED|ENETUNREACH)/i,
]

/** `https://host/path` and bare `host.tld` inside quotes or whitespace. */
const URL_IN_TEXT = /\bhttps?:\/\/([A-Za-z0-9._-]+)(?::\d+)?/gi

/**
 * Reachable regardless of the sandbox — `allowLocalBinding` covers these — so
 * suggesting somebody allowlist them would be advice that fixes nothing.
 */
function isLocal(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'localhost'
    || name.endsWith('.localhost')
    || name === '127.0.0.1'
    || name === '::1'
    || name === '0.0.0.0'
}

function isPlausibleHost(host: string): boolean {
  if (!host || isLocal(host)) return false
  // A hostname worth allowlisting has a dot and does not end in one.
  return host.includes('.') && !host.endsWith('.') && !/^\d+$/.test(host.replace(/\./g, ''))
}

function collect(pattern: RegExp, text: string): string[] {
  const found: string[] = []
  // Fresh lastIndex each call: these are module-level /g regexes.
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match[1]) found.push(match[1])
  }
  return found
}

/**
 * Which hosts this command was refused, if any.
 *
 * `command` is what was run and `output` is what came back; the host is looked
 * for in the output first, since that is where the program that failed said
 * what it wanted, and only then in the command.
 *
 * Returns an empty list when nothing here looks like a sandbox denial, which is
 * the overwhelmingly common case — this runs over every tool result.
 */
export function refusedHostsIn(
  command: string,
  output: string,
  opts: { allowed?: string[] } = {},
): string[] {
  const text = output ?? ''

  const dnsHosts = collect(DNS_REFUSAL, text)
  const proxyRefused = PROXY_REFUSALS.some(pattern => pattern.test(text))
  const unreachable = UNREACHABLE.some(pattern => pattern.test(text))

  if (!proxyRefused && !unreachable && !dnsHosts.length) return []

  const hosts = [...dnsHosts]

  // Neither a proxy refusal nor a timeout names the host it was about, so it
  // comes from the URL in the message and then from the command that produced
  // it — in that order, since the message is the more specific of the two.
  if (!hosts.length) hosts.push(...collect(URL_IN_TEXT, text))
  if (!hosts.length) hosts.push(...collect(URL_IN_TEXT, command ?? ''))

  const allowed = new Set((opts.allowed ?? []).map(host => host.toLowerCase()))

  return [...new Set(hosts.map(h => h.toLowerCase()).filter(isPlausibleHost))]
    // A host this project already allows, which still could not be reached, is
    // the network being unreliable rather than the sandbox refusing anything.
    // Reporting it would blame the wrong thing and suppress a useful retry.
    .filter(host => !allowed.has(host))
}

/**
 * Whether this looks like a sandbox denial at all, even when no host could be
 * named — `curl https://…` piped somewhere that swallowed the URL still means
 * the run was cut off, and saying so beats saying nothing.
 */
export function looksSandboxed(output: string): boolean {
  const text = output ?? ''
  if (PROXY_REFUSALS.some(pattern => pattern.test(text))) return true
  if (UNREACHABLE.some(pattern => pattern.test(text))) return true

  // `.test` on a /g regex advances lastIndex, so a second call on the same
  // string would answer differently. Reset rather than reason about it.
  DNS_REFUSAL.lastIndex = 0
  return DNS_REFUSAL.test(text)
}
