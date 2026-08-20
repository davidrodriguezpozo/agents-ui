import type { Tone } from './format'

/**
 * Markdown, for a terminal that cannot render it.
 *
 * Everything an agent writes is Markdown — headings, fences, `**bold**`,
 * backticked identifiers, bullet lists — and a pane that prints it verbatim
 * shows you the punctuation instead of the point. A review with six `###`
 * sections and forty inline spans is genuinely harder to read as source than
 * the same text would be as plain prose.
 *
 * This is deliberately not a Markdown implementation. It is the handful of
 * constructs that actually turn up in a transcript, rendered as weight and
 * colour, which is all a terminal has. Tables, footnotes and nested emphasis
 * are left alone rather than half-supported: text that passes through
 * unrecognised still reads, and that is the failure mode to aim for.
 */

export interface Span {
  text: string
  tone?: Tone
  bold?: boolean
  /** Underlined, for a heading — the one structural cue a terminal does well. */
  underline?: boolean
}

export interface RichLine {
  spans: Span[]
  /** The same line as plain text: what wrapping measured, and what tests read. */
  text: string
}

/** How code — fenced or inline — is coloured. */
const CODE: Tone = 'green'

export function markdownLines(source: string, width: number): RichLine[] {
  if (width <= 0) return []

  const lines: RichLine[] = []
  const raw = source.replace(/\r\n/g, '\n').split('\n')

  let fence: string | null = null

  for (const line of raw) {
    const fenced = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)

    if (fence) {
      if (fenced && fenced[1]!.startsWith(fence[0]!)) {
        fence = null
        continue
      }
      // Inside a fence nothing is markup, and nothing is re-wrapped either: code
      // that has been folded at 80 columns is no longer code.
      lines.push(code(line, width))
      continue
    }

    if (fenced) {
      fence = fenced[1]!
      const language = fenced[2]?.trim()
      if (language) lines.push({ spans: [{ text: `  ${language}`, tone: 'gray' }], text: `  ${language}` })
      continue
    }

    // A rule is the one block that is drawn rather than written.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      const rule = '─'.repeat(Math.max(4, Math.min(width, 40)))
      lines.push({ spans: [{ text: rule, tone: 'gray' }], text: rule })
      continue
    }

    if (!line.trim()) {
      lines.push({ spans: [], text: '' })
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const depth = heading[1]!.length
      const spans = inline(heading[2]!.replace(/\s+#+\s*$/, ''))
      for (const span of spans) {
        span.bold = true
        // Only the top couple of levels earn a rule under them; a transcript
        // full of underlines is a transcript of underlines.
        if (depth <= 2) span.underline = true
        span.tone ??= 'white'
      }
      lines.push(...wrap(spans, width, ''))
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      const spans = inline(quote[1]!)
      for (const span of spans) span.tone = 'gray'
      lines.push(...wrap(spans, width - 2, '│ ', '│ '))
      continue
    }

    const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line)
    if (bullet) {
      const indent = ' '.repeat(bullet[1]!.length)
      // `•` rather than `-`, so a list reads as a list and not as a diff.
      pushBullet(lines, indent, '• ', bullet[3]!, width)
      continue
    }

    const numbered = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line)
    if (numbered) {
      const indent = ' '.repeat(numbered[1]!.length)
      pushBullet(lines, indent, `${numbered[2]} `, numbered[3]!, width)
      continue
    }

    lines.push(...wrap(inline(line), width, ''))
  }

  return lines
}

function pushBullet(
  lines: RichLine[],
  indent: string,
  marker: string,
  rest: string,
  width: number,
) {
  const prefix = `${indent}${marker}`
  // Continuations line up under the text, not under the bullet.
  lines.push(...wrap(inline(rest), width - prefix.length, prefix, ' '.repeat(prefix.length)))
}

function code(line: string, width: number): RichLine {
  const text = `  ${line}`.slice(0, Math.max(2, width))
  return { spans: [{ text, tone: CODE }], text }
}

/**
 * The inline constructs, tokenised in one pass.
 *
 * Ordered so that code wins: a backticked span is literal, which is the whole
 * reason it is backticked, and `**` inside it is two asterisks.
 */
const INLINE = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\[([^\]]+?)\]\(([^)\s]+)\)|(\*|_)(?!\s)([^*_]+?)\7/g

export function inline(text: string): Span[] {
  const spans: Span[] = []
  let at = 0

  for (const match of text.matchAll(INLINE)) {
    const start = match.index
    if (start > at) spans.push({ text: text.slice(at, start) })

    if (match[2] != null) spans.push({ text: match[2], tone: CODE })
    else if (match[3] != null) spans.push({ text: match[3], bold: true })
    else if (match[4] != null) spans.push({ text: match[4], bold: true })
    else if (match[5] != null) {
      // A link is its text, and the target only when it says something the text
      // does not — a bare URL under every link is noise you cannot click anyway.
      spans.push({ text: match[5], underline: true })
      if (!match[5].includes(match[6]!)) spans.push({ text: ` (${match[6]})`, tone: 'gray' })
    } else if (match[8] != null) spans.push({ text: match[8] })

    at = start + match[0].length
  }

  if (at < text.length) spans.push({ text: text.slice(at) })
  return spans.length ? spans : [{ text }]
}

/**
 * Fold spans to a width, breaking at spaces and keeping each span's styling.
 *
 * The plain-text wrapper cannot do this: once a line is a list of styled pieces,
 * "how long is it" and "where does it break" are questions about the pieces
 * rather than about a string.
 */
export function wrap(
  spans: Span[],
  width: number,
  prefix = '',
  continuation = prefix,
): RichLine[] {
  const room = Math.max(8, width)
  const lines: RichLine[] = []

  let current: Span[] = []
  let length = 0
  let first = true

  const flush = () => {
    // The space that pushed the line over does not belong at the end of it.
    while (current.length && /^\s+$/.test(current[current.length - 1]!.text)) current.pop()
    const lead = first ? prefix : continuation
    const withPrefix = lead ? [{ text: lead, tone: 'gray' as Tone }, ...current] : current
    lines.push({ spans: withPrefix, text: withPrefix.map(span => span.text).join('') })
    current = []
    length = 0
    first = false
  }

  for (const span of spans) {
    // Split on spaces but keep them, so a break lands between words and the
    // spacing inside a line survives.
    for (const word of span.text.split(/(\s+)/)) {
      if (!word) continue

      if (length + word.length > room && length > 0) {
        flush()
        if (/^\s+$/.test(word)) continue
      }

      // A single word longer than the pane — a path, an identifier — is cut
      // rather than allowed to push the line over.
      if (word.length > room) {
        let rest = word
        while (rest.length > room) {
          current.push({ ...span, text: rest.slice(0, room) })
          length = room
          flush()
          rest = rest.slice(room)
        }
        if (rest) {
          current.push({ ...span, text: rest })
          length = rest.length
        }
        continue
      }

      current.push({ ...span, text: word })
      length += word.length
    }
  }

  if (current.length || lines.length === 0) flush()
  return lines
}
