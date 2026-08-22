import { describe, expect, it } from 'vitest'
import { orderEdges, orderTrain, type OrderCandidate } from '../server/utils/trainOrder'
import { planLanding, type LandingInput } from '../server/utils/landing'

/**
 * The order six parallel branches land in.
 *
 * Cost ordering was already right and is not what is tested here. What is new is
 * the constraint on top of it: merge the session that *settles* a name before
 * the session that calls it, so the second one is re-checked once against
 * finished code instead of twice against code that was about to change.
 *
 * The cases that decide whether this is trustworthy are the ones where it must
 * not act: sessions that have nothing to do with each other must keep the order
 * they had, and two sessions that use each other must be left alone with a
 * sentence rather than reordered on a guess.
 */

function candidate(id: string, over: Partial<OrderCandidate> = {}): OrderCandidate {
  return { id, title: id, need: 'ready', green: true, changedFiles: 1, ...over }
}

describe('who has to go first', () => {
  it('finds nothing between sessions that do not touch each other', () => {
    const edges = orderEdges([
      candidate('a', { provides: ['renderChart'], uses: ['useState'] }),
      candidate('b', { provides: ['parseCsv'], uses: ['readFile'] }),
    ])

    expect(edges).toEqual([])
  })

  it('puts the session that defines a name before the one that calls it', () => {
    const edges = orderEdges([
      candidate('defines', { provides: ['renderChart'] }),
      candidate('calls', { uses: ['renderChart'] }),
    ])

    expect(edges).toEqual([{ before: 'defines', after: 'calls', name: 'renderChart' }])
  })

  it('leaves a session that defines the name for itself out of it', () => {
    // Their use of it is theirs, whatever anybody else is defining elsewhere —
    // the same exclusion `findCollisions` makes.
    const edges = orderEdges([
      candidate('mine', { provides: ['helper'] }),
      candidate('theirs', { provides: ['helper'], uses: ['helper'] }),
    ])

    expect(edges).toEqual([])
  })

  it('ignores a name too short to be distinguishable from a loop variable', () => {
    const edges = orderEdges([
      candidate('a', { provides: ['id'] }),
      candidate('b', { uses: ['id'] }),
    ])

    expect(edges).toEqual([])
  })
})

describe('the order', () => {
  it('keeps cheapest-first when nothing depends on anything', () => {
    const order = orderTrain([
      candidate('behind', { need: 'update' }),
      candidate('unverified', { need: 'check' }),
      candidate('green', { need: 'ready' }),
    ])

    expect(order.order).toEqual(['green', 'unverified', 'behind'])
    expect(order.cycle).toBe(false)
    expect(order.why).toContain('None of these use each other')
  })

  it('puts a dependency first even when it is the expensive one', () => {
    const order = orderTrain([
      candidate('calls', { need: 'ready', uses: ['renderChart'] }),
      candidate('defines', { need: 'update', provides: ['renderChart'] }),
    ])

    // Cost alone would have merged the ready one first and then re-checked it
    // against a definition that had changed underneath it.
    expect(order.order).toEqual(['defines', 'calls'])
    expect(order.why).toContain('before the sessions that use them')
    expect(order.why).toContain('renderChart')
  })

  it('walks a chain of three in the only order that works', () => {
    const order = orderTrain([
      candidate('c', { uses: ['middle'] }),
      candidate('a', { provides: ['bottom'] }),
      candidate('b', { provides: ['middle'], uses: ['bottom'] }),
    ])

    expect(order.order).toEqual(['a', 'b', 'c'])
    expect(order.cycle).toBe(false)
  })

  it('says so and falls back when two sessions use each other', () => {
    const order = orderTrain([
      candidate('one', { title: 'Rename the parser', provides: ['parseCsv'], uses: ['renderChart'] }),
      candidate('two', { title: 'Chart the results', provides: ['renderChart'], uses: ['parseCsv'] }),
    ])

    expect(order.cycle).toBe(true)
    // The cheapest-first order, unchanged — not a guess at which half to break.
    expect(order.order).toEqual(['one', 'two'])
    expect(order.why).toContain('use each other')
    expect(order.why).toContain('no order')
    expect(order.why).toContain('Rename the parser')
  })

  it('does not loop on a cycle that also has independent sessions', () => {
    const order = orderTrain([
      candidate('loop-a', { provides: ['alpha'], uses: ['beta'] }),
      candidate('loop-b', { provides: ['beta'], uses: ['alpha'] }),
      candidate('alone', { need: 'ready' }),
    ])

    expect(order.cycle).toBe(true)
    expect(order.order).toHaveLength(3)
  })

  it('breaks a tie on the verdict, then on the size of the diff', () => {
    const order = orderTrain([
      candidate('big-green', { green: true, changedFiles: 40 }),
      candidate('small-green', { green: true, changedFiles: 2 }),
      candidate('unverified', { green: false, changedFiles: 1 }),
    ])

    expect(order.order).toEqual(['small-green', 'big-green', 'unverified'])
  })

  it('explains nothing when there is nothing to explain', () => {
    expect(orderTrain([candidate('only')]).why).toBe('')
  })

  it('is stable between two reads of the same state', () => {
    const cars = [candidate('b'), candidate('a')]

    expect(orderTrain(cars).order).toEqual(orderTrain([...cars].reverse()).order)
  })
})

describe('through the plan', () => {
  function session(id: string, over: Partial<LandingInput> = {}): LandingInput {
    return {
      id,
      title: id,
      status: 'idle' as LandingInput['status'],
      check: { status: 'passing' },
      worktree: { exists: true, changedFiles: 1, dirty: false, ahead: 1, behind: 0 },
      inBase: false,
      ...over,
    }
  }

  it('orders the queue by dependency and says why', () => {
    const plan = planLanding(
      [session('calls'), session('defines')],
      new Map([
        ['calls', { provides: [], uses: ['renderChart'] }],
        ['defines', { provides: ['renderChart'], uses: [] }],
      ]),
    )

    expect(plan.queue.map(c => c.id)).toEqual(['defines', 'calls'])
    expect(plan.why).toContain('renderChart')
  })

  it('behaves exactly as before when nothing knows about names', () => {
    const plan = planLanding([
      session('behind', { worktree: { exists: true, changedFiles: 1, dirty: false, ahead: 1, behind: 3 } }),
      session('green'),
    ])

    expect(plan.queue.map(c => c.id)).toEqual(['green', 'behind'])
    expect(plan.cycle).toBeUndefined()
  })

  it('places a session with no verdict after the green ones and still orders it', () => {
    const plan = planLanding(
      [
        session('unverified', { check: null }),
        session('green'),
      ],
      new Map([
        ['unverified', { provides: ['sharedThing'], uses: [] }],
        ['green', { provides: [], uses: ['sharedThing'] }],
      ]),
    )

    // The dependency wins over the cheaper need, because merging `green` first
    // means checking it again against a definition that is still moving.
    expect(plan.queue.map(c => c.id)).toEqual(['unverified', 'green'])
  })

  it('leaves blocked and landed sessions out of the ordering entirely', () => {
    const plan = planLanding(
      [
        session('failing', { check: { status: 'failing' } }),
        session('done', { inBase: true }),
        session('green'),
      ],
      new Map([['green', { provides: [], uses: ['whatever'] }]]),
    )

    expect(plan.queue.map(c => c.id)).toEqual(['green'])
    expect(plan.skipped.map(c => c.id)).toEqual(['failing'])
    expect(plan.landed.map(c => c.id)).toEqual(['done'])
  })
})
