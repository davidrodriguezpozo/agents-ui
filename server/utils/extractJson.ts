/**
 * Getting a JSON object back out of something a model wrote.
 *
 * Asking for "only valid JSON, nothing else" gets you JSON most of the time and
 * JSON-in-a-code-fence-with-a-paragraph-of-commentary the rest of it. Both are
 * the model being helpful; only one of them survives `JSON.parse`.
 *
 * The cost of getting this wrong is not a failed parse — it is what the caller
 * does next. A fallback that hands the raw text back as if it were the answer
 * turns "the model added a preamble" into a JSON blob pasted into somebody's
 * agent instructions, which is what happened before this existed.
 */

/**
 * The first balanced `{…}` in a string, or null.
 *
 * Brace-counting alone is not enough: a brace inside a string literal — and
 * `"\\"` before it — would end the object early and produce a slice that parses
 * to something wrong rather than failing honestly. So this tracks whether it is
 * inside a string, and whether the last character escaped the next one.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]!

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

/**
 * Parse a JSON object out of a model's reply, however it chose to wrap it.
 *
 * Tries the whole string, then the contents of a fenced block, then the first
 * balanced object anywhere in it. Returns null rather than throwing — a reply
 * this cannot read is a case the caller has to handle deliberately, not an
 * exception to bubble up as a 500.
 */
export function parseJsonFromReply<T = unknown>(reply: string): T | null {
  const trimmed = reply.trim()
  if (!trimmed) return null

  const candidates: string[] = [trimmed]

  // ```json … ``` is what a model reaches for when told to return only JSON.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) candidates.push(fenced[1].trim())

  for (const candidate of [...candidates]) {
    const object = firstJsonObject(candidate)
    if (object) candidates.push(object)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed && typeof parsed === 'object') return parsed as T
    } catch {
      // Try the next shape.
    }
  }

  return null
}
