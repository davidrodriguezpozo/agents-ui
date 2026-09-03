/**
 * `AskUserQuestion`, which arrives as a permission request and is not one.
 *
 * The CLI routes the question tool through the same `canUseTool` callback as
 * every other tool, and that callback is the only way an answer can be given:
 * the host allows the call with the answers written into
 * `updatedInput.answers`, keyed by the question's own text. Allow it the way
 * this app allowed everything else — behaviour `allow`, input handed straight
 * back — and the tool returns "The user did not answer the questions.", from
 * which the model concludes it is running somewhere non-interactive and stops
 * asking. That was the fate of every multiple-choice question any session here
 * ever asked: the prompt existed, nobody was shown it, and the answer the model
 * got back was that there was nobody to ask.
 *
 * So this file is the shape of that exchange, in both directions. `parseQuestions`
 * pulls the questions out of a tool input that arrives as `unknown` — and
 * returns nothing at all when they are not there, which is what makes an
 * unrecognisable call fall back to being an ordinary permission prompt rather
 * than rendering an empty dialog. `withAnswers` puts the selections back in the
 * form the CLI reads.
 */

export const ASK_USER_QUESTION = 'AskUserQuestion'

export interface QuestionOption {
  label: string
  description: string
  /** Mockup or snippet the CLI offers alongside an option, when it sends one. */
  preview?: string
}

export interface QuestionPrompt {
  question: string
  /** Short chip, e.g. `Approach`. Twelve characters by the tool's own schema. */
  header: string
  options: QuestionOption[]
  /** Several labels may be chosen, and they go back as one comma-joined answer. */
  multiSelect: boolean
}

/**
 * One question's answer as the browser sends it: the labels chosen, or a single
 * string somebody typed instead. Both are a list so there is one shape on the
 * wire, and the comma-joining the CLI expects happens here rather than in a
 * component.
 */
export type QuestionAnswers = Record<string, string[]>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function toOption(value: unknown): QuestionOption | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = text(raw.label)
  if (!label) return null
  return {
    label,
    description: text(raw.description) ?? '',
    ...(text(raw.preview) ? { preview: raw.preview as string } : {}),
  }
}

/**
 * The questions in a tool input, or an empty list when this is not a question
 * we can render. Nothing is invented: a question with no options left would be
 * a dialog with no answers in it, so it is dropped and the call goes back to
 * being an ordinary prompt the person can allow or deny.
 */
export function parseQuestions(input: unknown): QuestionPrompt[] {
  if (!input || typeof input !== 'object') return []
  const questions = (input as Record<string, unknown>).questions
  if (!Array.isArray(questions)) return []

  const parsed: QuestionPrompt[] = []

  for (const entry of questions) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const question = text(raw.question)
    if (!question) continue

    const options = Array.isArray(raw.options)
      ? raw.options.map(toOption).filter((option): option is QuestionOption => option !== null)
      : []
    if (!options.length) continue

    // The tool's own schema says texts are unique; a duplicate would collide in
    // the answers map, where the text is the key.
    if (parsed.some(other => other.question === question)) continue

    parsed.push({
      question,
      header: text(raw.header) ?? '',
      options,
      multiSelect: raw.multiSelect === true,
    })
  }

  return parsed
}

/**
 * The tool input to allow, carrying the answers.
 *
 * Only answers to questions that were actually asked survive, so a stale form
 * cannot write a key the CLI will read as a question of its own. An unanswered
 * question is simply left out — which is the CLI's own encoding of skipping, and
 * why "answer nothing" needs no special case anywhere above this.
 *
 * `annotations` carries the preview of whatever was chosen, because the tool
 * reports it back to the model as part of the answer and the browser should not
 * have to send back a string it was already given.
 */
export function withAnswers(
  input: Record<string, unknown>,
  answers: QuestionAnswers,
): Record<string, unknown> {
  const questions = parseQuestions(input)
  const chosen: Record<string, string> = {}
  const annotations: Record<string, { preview?: string }> = {}

  for (const question of questions) {
    const picked = (answers[question.question] ?? [])
      .map(value => value.trim())
      .filter(Boolean)
    if (!picked.length) continue

    chosen[question.question] = picked.join(', ')

    // Only for a real option: text somebody typed has no preview behind it.
    const preview = picked
      .map(label => question.options.find(option => option.label === label)?.preview)
      .find(Boolean)
    if (preview) annotations[question.question] = { preview }
  }

  return {
    ...input,
    ...(Object.keys(chosen).length ? { answers: chosen } : {}),
    ...(Object.keys(annotations).length ? { annotations } : {}),
  }
}

/**
 * The questions, small enough for a dashboard.
 *
 * The wall carries every waiting prompt for every session on the machine, and a
 * preview is a mockup — the one field in a question that can be arbitrarily
 * large. Dropped rather than truncated: half a mockup is not a mockup, and the
 * place to read one is the session, which has the request in full.
 */
export function compactQuestions(questions: QuestionPrompt[]): QuestionPrompt[] {
  return questions.map(question => ({
    ...question,
    options: question.options.map(({ label, description }) => ({ label, description })),
  }))
}
