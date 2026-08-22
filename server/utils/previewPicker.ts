import { selectorFor } from './previewSelector'

/**
 * The picker that runs inside the previewed page.
 *
 * The preview is an iframe pointed at the project's own dev server. Looking at
 * it answers "does this look right"; it does not help with the next question,
 * which is "this button is the wrong colour" — because saying that meant finding
 * the button again in the source by hand and typing a description of it into the
 * chat box. Pointing at it is the whole feature, and pointing needs code inside
 * the page: hover highlighting and a click that reports a selector are things
 * only the page's own document can do.
 *
 * **How it gets there.** Not through the iframe: the dev server is on its own
 * port, so it is a different origin and the parent cannot touch its document.
 * Instead `server/utils/previewProxy.ts` puts a small HTTP proxy in front of the
 * dev server, mirroring its whole path space, and adds one `<script defer>` tag
 * to every HTML response — this script, served by the proxy at `PICKER_PATH`.
 * The iframe points at the proxy, so the page is the project's page, running the
 * project's dev server, with one extra script in it.
 *
 * That is a real intrusion into somebody's page, so it is kept to the least it
 * can be: one deferred script, no styles beyond two absolutely-positioned
 * elements it creates and removes itself, and nothing at all happens until the
 * parent window asks for Point mode. Injecting into the project's own dev server
 * is fair game; injecting into anything else would not be, which is why the
 * proxy only ever fronts a port this app started.
 *
 * The two sides talk by `postMessage`, since proxy and app are still different
 * origins. Every message carries a `source` so neither end acts on traffic from
 * some other script on the page.
 */

/** Where the proxy serves this script. Long and ugly so a project cannot own it. */
export const PICKER_PATH = '/__agents_ui_element_picker.js'

/** Marks the parent window's messages, and the picker's replies. */
export const HOST_SOURCE = 'agents-ui-host'
export const PICKER_SOURCE = 'agents-ui-picker'

/*
 * The wire format is `PickedElement` in `app/utils/previewNotes.ts` — selector,
 * tag, visible text, route and box. It is declared there rather than here, and
 * not in both: the server never reads one, it only ships the code that makes
 * them, and a copy of the type on this side would be a copy free to drift.
 */

/**
 * The script, as text.
 *
 * Written in the previewed page's dialect rather than this project's: `var`,
 * no template literals, no optional chaining, string concatenation throughout.
 * It has to run in whatever browser somebody has the preview open in, and it is
 * never compiled — it is handed over exactly as it reads here.
 */
export function pickerScript(): string {
  return `;(function () {
  var HOST = ${JSON.stringify(HOST_SOURCE)}
  var SELF = ${JSON.stringify(PICKER_SOURCE)}
  var MARK = 'data-agents-ui-picker'

  var selectorFor = ${selectorFor.toString()}

  var on = false
  var box = null
  var label = null
  var host = null
  var hostOrigin = null

  function here() {
    return location.pathname + location.search
  }

  function tell(message) {
    message.source = SELF
    try {
      (host || window.parent).postMessage(message, hostOrigin || '*')
    } catch (e) {
      // The parent went away. Nothing to do and nothing worth logging.
    }
  }

  function mine(node) {
    return !!(node && node.getAttribute && node.getAttribute(MARK))
  }

  function build() {
    if (box || !document.body) return
    box = document.createElement('div')
    box.setAttribute(MARK, 'box')
    box.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483646;'
      + 'border:2px solid #6366f1;background:rgba(99,102,241,0.14);border-radius:2px;'
    label = document.createElement('div')
    label.setAttribute(MARK, 'label')
    label.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;'
      + 'background:#6366f1;color:#fff;padding:2px 6px;border-radius:3px;white-space:nowrap;'
      + 'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-width:80vw;'
      + 'overflow:hidden;text-overflow:ellipsis;'
    document.body.appendChild(box)
    document.body.appendChild(label)
  }

  function hide() {
    if (box) box.style.display = 'none'
    if (label) label.style.display = 'none'
  }

  function count(selector) {
    try {
      return document.querySelectorAll(selector).length
    } catch (e) {
      return 0
    }
  }

  function describe(element) {
    var rect = element.getBoundingClientRect()
    var text = (element.innerText || element.textContent || '')
    return {
      selector: selectorFor(element, count),
      tag: String(element.tagName || '').toLowerCase(),
      text: text.replace(/\\s+/g, ' ').trim().slice(0, 200),
      path: here(),
      box: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }
  }

  function draw(element) {
    build()
    if (!box) return
    var rect = element.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = rect.left + 'px'
    box.style.top = rect.top + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'

    label.textContent = selectorFor(element, count)
    label.style.display = 'block'
    // Above the element, unless that is off the top of the window.
    var above = rect.top - 20
    label.style.top = (above < 0 ? Math.min(rect.bottom + 4, window.innerHeight - 20) : above) + 'px'
    label.style.left = Math.max(0, Math.min(rect.left, window.innerWidth - 40)) + 'px'
  }

  function mode(next) {
    on = !!next
    if (on) {
      build()
      document.documentElement.style.cursor = 'crosshair'
    } else {
      document.documentElement.style.cursor = ''
      hide()
    }
  }

  document.addEventListener('mousemove', function (event) {
    if (!on) return
    var target = event.target
    if (!target || mine(target) || !target.getBoundingClientRect) return
    draw(target)
  }, true)

  document.addEventListener('mouseleave', function () {
    if (on) hide()
  }, true)

  document.addEventListener('scroll', function () {
    if (on) hide()
  }, true)

  /*
   * Capture, and the click is swallowed. In Point mode a click is a question
   * about the element, not a press of it — letting it through would navigate
   * away from the thing being described.
   */
  document.addEventListener('click', function (event) {
    if (!on) return
    var target = event.target
    if (!target || mine(target) || !target.getBoundingClientRect) return
    event.preventDefault()
    event.stopPropagation()
    if (event.stopImmediatePropagation) event.stopImmediatePropagation()
    mode(false)
    tell({ type: 'picked', element: describe(target) })
  }, true)

  document.addEventListener('keydown', function (event) {
    if (!on || event.key !== 'Escape') return
    mode(false)
    tell({ type: 'off' })
  }, true)

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== HOST) return
    host = event.source || window.parent
    hostOrigin = event.origin && event.origin !== 'null' ? event.origin : '*'

    if (data.type === 'ping') {
      tell({ type: 'ready', path: here() })
      return
    }
    if (data.type === 'point') {
      mode(data.on)
      tell({ type: data.on ? 'on' : 'off' })
    }
  })

  // Announced as well as answered: a navigation inside the preview loads a new
  // copy of this script, and the parent has no other way to learn about it.
  tell({ type: 'ready', path: here() })
})()
`
}

/** True for the responses worth rewriting — everything else is piped untouched. */
export function isHtmlResponse(contentType: string | undefined | null): boolean {
  if (!contentType) return false
  // Anchored at both ends: `\b` would take `text/html-sandboxed` for HTML,
  // because a hyphen counts as a word boundary.
  return /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(contentType)
}

const SCRIPT_TAG = `<script src="${PICKER_PATH}" defer data-agents-ui-picker="script"></script>`

/**
 * Add the one tag.
 *
 * Before `</head>` so it is parsed early and `defer`red so it still runs after
 * the body exists. A document with no head is a fragment a dev server is
 * streaming or an error page it wrote by hand; both are better off with the
 * script at the end than without it, so the tag is appended rather than
 * dropped. Idempotent, because a dev server that already includes the script
 * for some reason of its own should not get two.
 */
export function injectPicker(html: string): string {
  if (!html || html.includes(PICKER_PATH)) return html

  const head = html.search(/<\/head\s*>/i)
  if (head !== -1) return html.slice(0, head) + SCRIPT_TAG + html.slice(head)

  const body = html.search(/<\/body\s*>/i)
  if (body !== -1) return html.slice(0, body) + SCRIPT_TAG + html.slice(body)

  return html + SCRIPT_TAG
}
