import { describe, expect, it } from 'vitest'
import { scoreAgent, type QualityScore } from '../app/utils/agentScoring'

function score(
  fm: Partial<Parameters<typeof scoreAgent>[0]> = {},
  body = '',
): QualityScore {
  return scoreAgent(
    { name: 'test-agent', description: 'A test agent that does testing work', model: 'sonnet', ...fm },
    body,
  )
}

/** A body long enough to trigger the structure / role / constraints / format checks. */
const LONG_BODY = Array(60).fill('word').join(' ')

/** A body that passes every heuristic — role, constraints, format, structure. */
const GOOD_BODY = `# Review agent

You are a code reviewer. You must always check for bugs.

## Rules
- Never approve without reading every file
- Always respond with a structured summary

## Output format
Return a markdown list of findings.`

describe('scoreAgent', () => {
  it('gives 100 to a well-formed agent', () => {
    const s = score({}, GOOD_BODY)
    expect(s.score).toBe(100)
    expect(s.label).toBe('Good')
    expect(s.issues).toHaveLength(0)
  })

  it('deducts 20 for a missing name', () => {
    const s = score({ name: '  ' }, GOOD_BODY)
    expect(s.score).toBe(80)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('no name') }))
  })

  it('deducts 15 for a missing description', () => {
    const s = score({ description: '' }, GOOD_BODY)
    expect(s.score).toBe(85)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'error' }))
  })

  it('deducts 5 for a short description', () => {
    const s = score({ description: 'short' }, GOOD_BODY)
    expect(s.score).toBe(95)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'warning' }))
  })

  it('deducts 3 for no model', () => {
    const s = score({ model: undefined }, GOOD_BODY)
    expect(s.score).toBe(97)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'tip' }))
  })

  it('deducts 30 for an empty body', () => {
    const s = score({}, '   ')
    expect(s.score).toBe(70)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('No instructions') }))
  })

  it('deducts 10 for a very brief body', () => {
    const s = score({}, 'Do the thing.')
    expect(s.score).toBeLessThan(100)
    expect(s.issues).toContainEqual(expect.objectContaining({ type: 'warning', message: expect.stringContaining('brief') }))
  })

  it('deducts 5 for a long body with no structure', () => {
    // Long, no headers or lists
    const s = score({}, LONG_BODY)
    expect(s.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('structure') }))
  })

  it('does not penalise structure in a short body', () => {
    const s = score({}, 'You are a helper. Do not make mistakes. Return formatted output.')
    expect(s.issues.find(i => i.message.includes('structure'))).toBeUndefined()
  })

  it('deducts 3 for missing role definition', () => {
    const body = '# Steps\n- Check the code\n- Never approve blindly\n- Return a formatted list'
    const s = score({}, body)
    expect(s.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('role') }))
  })

  it('deducts 3 for missing constraints in a long body', () => {
    // Has role and format, but no constraint words
    const body = 'You are a helper. ' + Array(40).fill('word').join(' ') + ' Return output.'
    const s = score({}, body)
    expect(s.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('rules') }))
  })

  it('deducts 2 for missing format guidance in a long body', () => {
    // Has role and constraints, but no format words
    const body = 'You are a helper. Never skip a step. Always be thorough. ' + Array(40).fill('word').join(' ')
    const s = score({}, body)
    expect(s.issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('output format') }))
  })

  it('bottoms out at the sum of applicable deductions, not below 0', () => {
    // name(20) + description(15) + model(3) + body(30) = 68 deducted → score 32
    const s = score({ name: '', description: '', model: undefined }, '')
    expect(s.score).toBe(32)
    expect(s.label).toBe('Incomplete')
  })

  it('labels scores in the right bands', () => {
    expect(score({}, GOOD_BODY).label).toBe('Good')           // 100
    expect(score({ description: '' }, GOOD_BODY).label).toBe('Good')  // 85
    expect(score({ description: '', model: undefined }, GOOD_BODY).label).toBe('Good') // 82
    expect(score({}, '   ').label).toBe('Okay')                // 70
    expect(score({ name: '', description: '' }, '   ').label).toBe('Incomplete') // 32
  })

  it('never returns a score above 100', () => {
    // Even if somehow no deductions, it should cap at 100
    expect(score({}, GOOD_BODY).score).toBeLessThanOrEqual(100)
  })
})
