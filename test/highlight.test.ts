import { describe, expect, it } from 'vitest'
import {
  MAX_HIGHLIGHT_BYTES, languageFor, tokenize, type Token,
} from '../app/utils/highlight'

/**
 * A one-pass highlighter is wrong in the corners by design. The properties that
 * must hold anyway are the ones tested here:
 *
 *   - It never loses or reorders a character. The tokens are rendered instead
 *     of the file, so anything dropped here is a file that displays wrong and
 *     then gets saved back that way if somebody edits it.
 *   - It always terminates. A pattern that can match empty would never advance
 *     the cursor, which is the one way this hangs the tab.
 */

const text = (tokens: Token[]) => tokens.map(t => t.text).join('')
const typesOf = (tokens: Token[], type: string) =>
  tokens.filter(t => t.type === type).map(t => t.text)

describe('never losing the file', () => {
  const samples: [string, string][] = [
    ['js', 'const a = "x" // note\nfunction f(b) { return 1.5 }'],
    ['json', '{"key": "value", "n": -1.2e3, "ok": true, "no": null}'],
    ['markdown', '# Title\n\nSome **bold** and `code` and [a](b).\n\n```js\nlet x\n```'],
    ['css', '.a { color: #fff; width: 10px } /* c */'],
    ['markup', '<div class="a" id=\'b\'>text</div><!-- c -->'],
    ['python', 'def f(x):\n    """doc"""\n    return None  # done'],
    ['shell', 'echo "$HOME" # comment\nif [ -f x ]; then cd /tmp; fi'],
    ['yaml', 'key: value\nlist:\n  - 1\n  # note\n  other: true'],
  ]

  for (const [lang, code] of samples) {
    it(`reassembles ${lang} exactly`, () => {
      expect(text(tokenize(code, lang as never))).toBe(code)
    })
  }

  it('reassembles an empty file to nothing', () => {
    expect(tokenize('', 'js')).toEqual([])
  })

  /**
   * The regression that motivated the guard in `tokenize`.
   *
   * The markdown list rule carried an `m` flag, so `^` matched at every line
   * start and `exec` could return a match from the *middle* of the remaining
   * text. The cursor then advanced past characters that were never emitted, and
   * a README rendered as "# demo- - - - - * - -" — the file, shuffled.
   *
   * The round-trip check above was already the right property; the sample
   * simply had no list item in it, which is why the bug reached a browser.
   */
  it('reassembles markdown containing a list, which once shuffled the file', () => {
    const code = '# demo\n\nSome **bold** text.\n\n- a list item\n- another\n\n> quoted\n'
    expect(text(tokenize(code, 'markdown'))).toBe(code)
  })

  it('reassembles every language on input built to trip the rules', () => {
    // One corpus run against all of them: a rule that matches away from the
    // start corrupts whatever language it belongs to, so the property is worth
    // asserting language by language rather than on one sample.
    const nasty = [
      '- dash at start', '* star', '> quote', '# hash', '@at', '$var',
      'a "string" and \'another\'', '/* block */ // line', '#comment',
      '{ "k": [1, 2.5, -3e4, true, null] }', '<tag attr="v"/>', '`tick`',
      'trailing backslash \\', 'tab\there', '',
    ].join('\n')

    for (const lang of ['js', 'json', 'markdown', 'css', 'markup', 'python', 'shell', 'yaml', 'plain'] as const) {
      expect(text(tokenize(nasty, lang)), `language: ${lang}`).toBe(nasty)
    }
  })

  it('reassembles a file that is only whitespace', () => {
    expect(text(tokenize('\n\n   \n', 'js'))).toBe('\n\n   \n')
  })

  it('does not choke on an unterminated string', () => {
    // Half-typed code is the normal state of a file being edited.
    const code = 'const a = "unterminated\nconst b = 1'
    expect(text(tokenize(code, 'js'))).toBe(code)
  })

  it('does not choke on an unterminated block comment', () => {
    const code = '/* never closed\nconst a = 1'
    expect(text(tokenize(code, 'js'))).toBe(code)
  })

  it('does not choke on an unterminated markdown fence', () => {
    const code = '```js\nlet x = 1\n'
    expect(text(tokenize(code, 'markdown'))).toBe(code)
  })
})

describe('colouring the things worth colouring', () => {
  it('finds comments and strings in javascript', () => {
    const tokens = tokenize('const a = "x" // note', 'js')

    expect(typesOf(tokens, 'comment')).toEqual(['// note'])
    expect(typesOf(tokens, 'string')).toEqual(['"x"'])
    expect(typesOf(tokens, 'keyword')).toEqual(['const'])
  })

  it('tells a JSON key from a JSON string value', () => {
    const tokens = tokenize('{"key": "value"}', 'json')

    expect(typesOf(tokens, 'property')).toEqual(['"key"'])
    expect(typesOf(tokens, 'string')).toEqual(['"value"'])
  })

  it('does not treat a comment marker inside a string as a comment', () => {
    // The string rule comes first, which is the whole reason order matters.
    const tokens = tokenize('const url = "https://example.com"', 'js')

    expect(typesOf(tokens, 'comment')).toEqual([])
    expect(typesOf(tokens, 'string')).toEqual(['"https://example.com"'])
  })

  it('handles an escaped quote inside a string', () => {
    const tokens = tokenize('const a = "he said \\"hi\\"" ', 'js')
    expect(typesOf(tokens, 'string')).toEqual(['"he said \\"hi\\""'])
  })

  it('finds headings and fenced code in markdown', () => {
    const tokens = tokenize('# Title\n\n```js\nx\n```', 'markdown')

    expect(typesOf(tokens, 'keyword')).toEqual(['# Title'])
    expect(typesOf(tokens, 'string')).toEqual(['```js\nx\n```'])
  })
})

describe('picking a language', () => {
  it('reads it off the extension', () => {
    expect(languageFor('src/app.ts')).toBe('js')
    expect(languageFor('a/b/data.json')).toBe('json')
    expect(languageFor('README.md')).toBe('markdown')
    expect(languageFor('styles/main.css')).toBe('css')
    expect(languageFor('index.html')).toBe('markup')
    expect(languageFor('run.py')).toBe('python')
    expect(languageFor('deploy.sh')).toBe('shell')
    expect(languageFor('ci.yml')).toBe('yaml')
  })

  it('knows the files that have no extension', () => {
    expect(languageFor('Makefile')).toBe('shell')
    expect(languageFor('Dockerfile')).toBe('shell')
    expect(languageFor('.env.local')).toBe('shell')
  })

  it('falls back to plain rather than guessing', () => {
    expect(languageFor('LICENSE')).toBe('plain')
    expect(languageFor('notes.wat')).toBe('plain')
  })

  it('leaves plain text in one piece', () => {
    const code = 'just some words\nand more'
    expect(tokenize(code, 'plain')).toEqual([{ type: 'plain', text: code }])
  })
})

describe('when a file is too big to be worth it', () => {
  it('gives up colouring rather than making thousands of spans', () => {
    const code = `const a = 1\n`.repeat(Math.ceil(MAX_HIGHLIGHT_BYTES / 12) + 1)

    const tokens = tokenize(code, 'js')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.type).toBe('plain')
    // Still the whole file, just uncoloured.
    expect(text(tokens)).toBe(code)
  })
})
