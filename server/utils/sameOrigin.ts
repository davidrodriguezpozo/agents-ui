/**
 * Deciding whether a request came from this app or from someone else's web page.
 *
 * This app has no authentication, by design: it is yours, on your machine. But
 * "on your machine" is not the same as "only reachable by you". A browser will
 * happily send a request to `http://localhost:3000` on behalf of any page you
 * happen to have open, and until this existed that was enough to own the
 * machine:
 *
 *   1. You visit a page while this is running.
 *   2. It submits a hidden form to `/api/project/checks` — a form POST is a
 *      "simple request", so there is no CORS preflight to refuse it, and no
 *      CORS headers are needed to *send* one. Only reading the reply is
 *      blocked, and the attacker does not need to read anything.
 *   3. The shell command it set runs the next time a session changes a file.
 *
 * Demonstrated end to end before this was written: `id` written to a file, as
 * the logged-in user, from nothing but a cross-origin form post.
 *
 * The second half is DNS rebinding: a name the attacker controls, answering
 * first with their address and then with 127.0.0.1, makes their page
 * genuinely same-origin with this server — at which point they can read
 * everything too. The defence for that is refusing to answer to a `Host` we
 * do not recognise, which is why the host check is not redundant with the
 * origin check.
 */

/** Loopback, and literal IP addresses, which a rebinding attack cannot use. */
export function isTrustedHostname(hostname: string): boolean {
  const name = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!name) return false

  if (name === 'localhost' || name.endsWith('.localhost')) return true
  if (name === '::1' || name === '0:0:0:0:0:0:0:1') return true

  // A literal address is safe: rebinding needs a *name* to re-point. Someone
  // reaching this from their phone over the LAN types an address, so refusing
  // those would break the one legitimate reason to bind beyond loopback.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) {
    return name.split('.').every(part => Number(part) <= 255)
  }
  if (/^[0-9a-f:]+$/.test(name) && name.includes(':')) return true

  return false
}

/** Extra names the person has said are theirs, for a reverse proxy or a tunnel. */
export function allowedHostsFromEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
}

export function hostIsAllowed(hostHeader: string | undefined, allowList: string[]): boolean {
  if (!hostHeader) return false

  // Strip the port: `localhost:3000` and `localhost` are the same host here.
  const hostname = hostHeader.replace(/:\d+$/, '').toLowerCase()

  return isTrustedHostname(hostname) || allowList.includes(hostname)
}

/** Methods that can change something. GETs are readable but not destructive. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface OriginCheck {
  method: string
  /** The `Origin` header, sent by browsers on any cross-origin request. */
  origin?: string
  /** `Sec-Fetch-Site`, which modern browsers send and pages cannot forge. */
  secFetchSite?: string
  host?: string
}

export type Verdict =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Whether a state-changing request may proceed.
 *
 * Two signals, because either alone has a gap. `Sec-Fetch-Site` is the
 * stronger one — a page cannot set it, and it distinguishes "this app asked"
 * from "some other site asked" without any parsing. `Origin` covers whatever
 * does not send it.
 *
 * A request with neither is allowed through: that is `curl`, a script, an
 * editor extension — another program already running as you, which is the
 * trust boundary this app has always had. The attack being closed here is a
 * *web page*, and web pages cannot omit these.
 */
export function checkOrigin(request: OriginCheck, allowList: string[] = []): Verdict {
  if (!hostIsAllowed(request.host, allowList)) {
    return {
      allowed: false,
      reason: `This server does not answer to the host "${request.host ?? '(none)'}". `
        + 'If you are reaching it through a proxy or a tunnel, name that host in AGENTS_STUDIO_ALLOWED_HOSTS.',
    }
  }

  if (SAFE_METHODS.has(request.method.toUpperCase())) return { allowed: true }

  const site = request.secFetchSite?.toLowerCase()
  if (site) {
    // `none` is a user typing the address; `same-origin` is this app's own UI.
    if (site === 'same-origin' || site === 'none') return { allowed: true }
    return {
      allowed: false,
      reason: `Blocked a ${request.method} that came from another site. `
        + 'Only this app may change things here.',
    }
  }

  if (request.origin) {
    let originHost: string
    try {
      originHost = new URL(request.origin).host.toLowerCase()
    } catch {
      return { allowed: false, reason: 'Blocked a request with an unreadable Origin.' }
    }

    if (originHost !== (request.host ?? '').toLowerCase()) {
      return {
        allowed: false,
        reason: `Blocked a ${request.method} from ${request.origin}, which is not this app.`,
      }
    }
  }

  return { allowed: true }
}
