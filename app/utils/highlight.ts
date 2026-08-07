/**
 * Just enough syntax highlighting to make a file readable.
 *
 * Not a parser and not trying to be. It is a single left-to-right pass with a
 * short list of patterns per language, which is wrong in the corners — a `//`
 * inside a regex literal, say — and right often enough that code stops looking
 * like a wall of one colour. The alternative was a highlighting library, which
 * for "some nice colours" is a lot of weight to carry, and this project
 * deliberately ships an install that resolves nothing.
 *
 * Returns tokens rather than HTML on purpose. The component renders them as
 * spans with `{{ }}`, so nothing here can produce markup and there is no
 * escaping bug to get wrong — which there would be the moment this built a
 * string and handed it to `v-html`.
 */

export type TokenType
  = 'plain' | 'comment' | 'string' | 'number' | 'keyword'
    | 'literal' | 'function' | 'property' | 'tag' | 'attribute' | 'punctuation'

export interface Token {
  type: TokenType
  text: string
}

export type Language
  = 'js' | 'json' | 'markdown' | 'css' | 'markup' | 'python' | 'shell' | 'yaml' | 'plain'

type Rule = [TokenType, RegExp]

const JS_KEYWORDS = /^(?:const|let|var|function|return|if|else|for|while|do|break|continue|class|extends|new|this|super|import|export|from|as|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|delete|void|yield|switch|case|interface|type|enum|implements|public|private|protected|readonly|static|declare|namespace|satisfies|keyof|infer)\b/
const PY_KEYWORDS = /^(?:def|class|return|if|elif|else|for|while|break|continue|import|from|as|pass|raise|try|except|finally|with|lambda|global|nonlocal|assert|yield|async|await|del|not|and|or|is|in)\b/
const SH_KEYWORDS = /^(?:if|then|elif|else|fi|for|while|do|done|case|esac|function|return|export|local|source|echo|cd|set|unset|read|shift|exit|trap)\b/

/** Order matters: the first pattern that matches at a position wins. */
const RULES: Record<Language, Rule[]> = {
  js: [
    ['comment', /^\/\/[^\n]*/],
    ['comment', /^\/\*[\s\S]*?\*\//],
    ['string', /^`(?:\\.|[^`\\])*`/],
    ['string', /^"(?:\\.|[^"\\\n])*"/],
    ['string', /^'(?:\\.|[^'\\\n])*'/],
    ['literal', /^\b(?:true|false|null|undefined|NaN|Infinity)\b/],
    ['keyword', JS_KEYWORDS],
    ['number', /^\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
    ['function', /^\b[A-Za-z_$][\w$]*(?=\s*\()/],
    ['punctuation', /^[{}[\]();,.:?=<>!+\-*/%&|^~]+/],
  ],
  json: [
    ['property', /^"(?:\\.|[^"\\\n])*"(?=\s*:)/],
    ['string', /^"(?:\\.|[^"\\\n])*"/],
    ['literal', /^\b(?:true|false|null)\b/],
    ['number', /^-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/],
    ['punctuation', /^[{}[\],:]+/],
  ],
  markdown: [
    ['comment', /^<!--[\s\S]*?-->/],
    ['keyword', /^#{1,6}[^\n]*/],
    ['string', /^```[\s\S]*?(?:```|$)/],
    ['string', /^`[^`\n]*`/],
    ['function', /^!?\[[^\]\n]*\]\([^)\n]*\)/],
    ['property', /^(?:\*\*|__)(?:[^*_\n]|\*(?!\*))+(?:\*\*|__)/],
    // No `m` flag, and one caret. With `m`, `^` matches at every line start,
    // so `exec` could match in the *middle* of the remaining text and the
    // cursor would then advance past characters that were never emitted —
    // silently reordering the file on screen.
    ['punctuation', /^[-*+>]\s/],
  ],
  css: [
    ['comment', /^\/\*[\s\S]*?\*\//],
    ['string', /^"(?:\\.|[^"\\\n])*"|^'(?:\\.|[^'\\\n])*'/],
    ['keyword', /^@[\w-]+/],
    ['property', /^[a-zA-Z-]+(?=\s*:)/],
    ['literal', /^#[0-9a-fA-F]{3,8}\b/],
    ['number', /^-?\b\d*\.?\d+(?:px|rem|em|%|vh|vw|s|ms|fr|deg)?\b/],
    ['punctuation', /^[{}();:,]+/],
  ],
  markup: [
    ['comment', /^<!--[\s\S]*?-->/],
    ['tag', /^<\/?[\w-]+/],
    ['tag', /^\/?>/],
    ['string', /^"(?:\\.|[^"\\\n])*"|^'(?:\\.|[^'\\\n])*'/],
    ['attribute', /^[\w:@.-]+(?==)/],
  ],
  python: [
    ['comment', /^#[^\n]*/],
    ['string', /^(?:"""[\s\S]*?"""|'''[\s\S]*?''')/],
    ['string', /^"(?:\\.|[^"\\\n])*"|^'(?:\\.|[^'\\\n])*'/],
    ['literal', /^\b(?:True|False|None)\b/],
    ['keyword', PY_KEYWORDS],
    ['function', /^@[\w.]+/],
    ['number', /^\b\d[\d_]*(?:\.\d+)?\b/],
    ['punctuation', /^[{}[\]();,.:=<>!+\-*/%|&]+/],
  ],
  shell: [
    ['comment', /^#[^\n]*/],
    ['string', /^"(?:\\.|[^"\\])*"|^'[^']*'/],
    ['property', /^\$\{?[\w]+\}?/],
    ['keyword', SH_KEYWORDS],
    ['number', /^\b\d+\b/],
    ['punctuation', /^[|&;()<>]+/],
  ],
  yaml: [
    ['comment', /^#[^\n]*/],
    ['property', /^[\w.$-]+(?=\s*:)/],
    ['string', /^"(?:\\.|[^"\\\n])*"|^'[^'\n]*'/],
    ['literal', /^\b(?:true|false|null|yes|no)\b/],
    ['number', /^-?\b\d+(?:\.\d+)?\b/],
    ['punctuation', /^[-:>|]+/],
  ],
  plain: [],
}

const BY_EXTENSION: Record<string, Language> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'markup',
  json: 'json', jsonc: 'json',
  md: 'markdown', markdown: 'markdown',
  css: 'css', scss: 'css', less: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  yml: 'yaml', yaml: 'yaml',
}

export function languageFor(path: string): Language {
  const name = path.split('/').pop() ?? ''
  if (name === 'Makefile' || name === 'makefile') return 'shell'
  if (name.startsWith('.env')) return 'shell'
  if (name === 'Dockerfile') return 'shell'

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return BY_EXTENSION[ext] ?? 'plain'
}

/**
 * Past this, colouring costs more than it gives: a span per token over a very
 * large file is thousands of DOM nodes for something being skimmed. Plain text
 * is the honest fallback rather than a frozen tab.
 */
export const MAX_HIGHLIGHT_BYTES = 200_000

export function tokenize(code: string, language: Language): Token[] {
  const rules = RULES[language]
  if (!rules.length || code.length > MAX_HIGHLIGHT_BYTES) {
    return code ? [{ type: 'plain', text: code }] : []
  }

  const tokens: Token[] = []
  let plain = ''
  let i = 0

  const flush = () => {
    if (plain) {
      tokens.push({ type: 'plain', text: plain })
      plain = ''
    }
  }

  while (i < code.length) {
    const rest = code.slice(i)
    let matched = false

    for (const [type, pattern] of rules) {
      const m = pattern.exec(rest)
      // Two ways a rule can quietly corrupt the file, both guarded here rather
      // than trusted to every pattern being written correctly:
      //
      //   - A zero-length match never advances `i`, which hangs the tab.
      //   - A match that did not start at position 0 — possible the moment a
      //     pattern carries the `m` flag — would make the cursor skip the text
      //     in front of it, dropping characters that were never emitted.
      if (m && m[0].length > 0 && m.index === 0) {
        flush()
        tokens.push({ type, text: m[0] })
        i += m[0].length
        matched = true
        break
      }
    }

    if (!matched) {
      plain += code[i]
      i += 1
    }
  }

  flush()
  return tokens
}
