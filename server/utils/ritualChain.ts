import type { RitualOutcome } from './ritualHistory'

/**
 * A ritual that is several steps rather than one instruction.
 *
 * Triage what came in, fix what can be fixed, verify the fix, open a pull
 * request. Written as four rituals that is four of everything: four rows, four
 * failing streaks, four give-up decisions, and four things to read in a morning
 * where only one thing actually happened. Worse, none of them knows what the
 * one before it found — the fix starts by working out what triage already knew.
 *
 * A chain is one ritual with an ordered list of steps. That is the whole idea,
 * and every consequence below follows from it:
 *
 *   - **One health record.** The steps produce a run each, but the *ritual* has
 *     one outcome per firing. `collapseChains` is what enforces it, and without
 *     it a three-step chain failing once would look like three failures and
 *     `shouldGiveUp` would turn the ritual off after a single bad morning.
 *   - **Each step knows what the last one found.** The output travels forward,
 *     which is the reason to chain rather than to schedule three things a few
 *     minutes apart.
 *   - **It stops at the first thing that does not work.** Verifying a fix that
 *     failed is a way to spend money confirming it. A step that comes back
 *     anything other than `ok` ends the firing there.
 */

export interface ChainStep {
  /** What this step is for, in the words the Activity row will carry. */
  title: string
  input: string
}

/**
 * Most steps a chain may have.
 *
 * Not a technical limit — a guard on the one shape of mistake this makes
 * possible. Every step is an agent invocation, so a chain is the one place in
 * this app where a single typo multiplies what a firing costs. Six is longer
 * than any of the sequences this was designed for.
 */
export const MAX_CHAIN_STEPS = 6

/** How much of an earlier step's output travels to the next one. */
const STEP_CARRY = 2000

/** And the most all of them together may add up to. */
const CARRY_TOTAL = 6000

/**
 * A step's prompt, with what the earlier steps produced.
 *
 * Appended as trailing context rather than woven in, for the reason
 * `promptFor` gives: the instruction somebody wrote has to still be the
 * instruction that arrives.
 *
 * Newest first, and cut at a total. A triage step that printed a thousand lines
 * would otherwise push the actual instruction out of the useful part of the
 * context, and the step most worth reading is always the one just before.
 */
export function chainPrompt(step: ChainStep, earlier: { title: string; output: string }[]): string {
  if (!earlier.length) return step.input

  const parts: string[] = []
  let budget = CARRY_TOTAL

  for (const done of [...earlier].reverse()) {
    if (budget <= 0) break

    const room = Math.min(STEP_CARRY, budget)
    const text = (done.output || '(this step produced no output)').trim()
    const clipped = text.length > room ? `…${text.slice(-room)}` : text

    parts.push(`## ${done.title}\n\n${clipped}`)
    budget -= clipped.length
  }

  const dropped = earlier.length - parts.length
  const note = dropped > 0
    ? `\n\n(${dropped} earlier ${dropped === 1 ? 'step is' : 'steps are'} not shown.)`
    : ''

  return `${step.input}

---

Earlier in this chain, most recent first:

${parts.join('\n\n')}${note}`
}

/**
 * What a firing amounts to, from the steps that ran.
 *
 * Precedence rather than "the last one wins", because a group being collapsed
 * may still have a step in flight, and because the useful answer to "how did
 * this morning go" is the worst thing that happened rather than the most
 * recent.
 *
 * An empty group is `running`: a chain whose first run has been created but has
 * not yet reported cannot be counted as a success.
 */
export function chainOutcome(outcomes: RitualOutcome[]): RitualOutcome {
  if (!outcomes.length) return 'running'
  if (outcomes.includes('running')) return 'running'
  if (outcomes.includes('failed')) return 'failed'
  if (outcomes.includes('blocked')) return 'blocked'
  if (outcomes.includes('stopped')) return 'stopped'
  return 'ok'
}

/** Whether the chain carries on after a step that came back like this. */
export function shouldContinue(outcome: RitualOutcome): boolean {
  return outcome === 'ok'
}

/**
 * What to call the run a step produces.
 *
 * The ritual's name says what the work is; the step says which part of it this
 * row was — the same problem event triggers had, and the same answer. The
 * position is included because "Fix" on its own does not say whether the thing
 * before it ran.
 */
export function stepTitleFor(ritualTitle: string, step: ChainStep, index: number, total: number): string {
  return `${ritualTitle} · ${index + 1}/${total} ${step.title}`
}

/**
 * Clean up what came out of a form.
 *
 * A step with no instruction is not a step, and a chain of one is a plain
 * ritual — returning undefined for both means the rest of the app never has to
 * ask whether a one-step chain is a chain.
 */
export function normalizeSteps(input: unknown): ChainStep[] | undefined {
  if (!Array.isArray(input)) return undefined

  const steps = input
    .map((raw, i) => {
      const step = raw as Partial<ChainStep>
      return {
        title: String(step?.title ?? '').trim() || `Step ${i + 1}`,
        input: String(step?.input ?? '').trim(),
      }
    })
    .filter(step => step.input)
    .slice(0, MAX_CHAIN_STEPS)

  return steps.length > 1 ? steps : undefined
}
