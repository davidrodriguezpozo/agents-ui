import { describe, expect, it } from 'vitest'
import { answeringModel } from '../../server/utils/providers/claude'

/**
 * Which model answered.
 *
 * The failure this exists for is not a crash — it is a ledger that has been
 * grouping every turn under `undefined` since the day it shipped, because the
 * only model it recorded was the one somebody asked for by name and almost
 * nobody ever does.
 */
describe('answeringModel', () => {
  it('reads the model off an assistant message', () => {
    expect(answeringModel({
      type: 'assistant',
      message: { model: 'claude-opus-5', content: [] },
    })).toBe('claude-opus-5')
  })

  it('is absent for a message that names no model', () => {
    expect(answeringModel({ type: 'assistant', message: { content: [] } })).toBeUndefined()
  })

  it('treats an empty model as absent, not as a name', () => {
    // A row on the ledger called "" is worse than a turn that admits it does
    // not know which model ran it.
    expect(answeringModel({ type: 'assistant', message: { model: '', content: [] } })).toBeUndefined()
  })

  it('is absent for anything that is not shaped like one', () => {
    expect(answeringModel(null)).toBeUndefined()
    expect(answeringModel({ type: 'result', total_cost_usd: 1 })).toBeUndefined()
    expect(answeringModel({ type: 'assistant', message: { model: 42 } })).toBeUndefined()
  })

  it('last one wins, folded the way the turn folds it', () => {
    const stream = [
      { type: 'assistant', message: { model: 'claude-opus-5' } },
      { type: 'stream_event' },
      { type: 'assistant', message: { model: 'claude-haiku-4-5' } },
      { type: 'result' },
    ]

    let model: string | undefined
    for (const message of stream) model = answeringModel(message) ?? model

    expect(model).toBe('claude-haiku-4-5')
  })
})
