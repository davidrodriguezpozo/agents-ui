import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStdout } from 'ink'
import { isAbort } from '../client'
import { describeError } from '../errors'

/**
 * How wide and how tall, kept current through a resize.
 *
 * Every pane here decides what fits before it draws — how many transcript lines,
 * how much of a title. Read once at startup, all of that is wrong the moment
 * somebody drags the window.
 */
export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout()
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  })

  useEffect(() => {
    if (!stdout) return
    const onResize = () => {
      const columns = stdout.columns ?? 80
      const rows = stdout.rows ?? 24
      // Same numbers as a new object would still re-render, and Ink writing to
      // stdout can emit `resize` on some terminals — which is how a list
      // starts blinking and never stops.
      setSize(prev => (prev.columns === columns && prev.rows === rows ? prev : { columns, rows }))
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])

  return size
}

export interface Polled<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** The last attempt failed but there is still something on screen to read. */
  stale: boolean
  refresh: () => void
}

export interface PollOptions {
  /** How often to ask while something could still change on its own. */
  every: number
  /**
   * How often to ask when nothing is moving. Defaults to a slow tick rather
   * than never, so a ritual firing somewhere else still turns up.
   */
  idle?: number
  /**
   * Whether anything is live. The browser's work page has had this rule all
   * along — see `app/pages/work.vue`, which skips the tick unless a session or
   * a run is going, because the list costs several `git` invocations per
   * session. A terminal app that sits open all day should be stricter than a
   * tab, not looser.
   */
  live?: boolean
  /** Off entirely — a pane that is closed should not be spending `git`. */
  enabled?: boolean
  deps?: unknown[]
}

/**
 * Keep something from the API current.
 *
 * The two rules that matter are here rather than in each caller: one request in
 * flight at a time, and nothing written to a component that has gone away.
 */
export function usePoll<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: PollOptions,
): Polled<T> {
  const { every, idle = 30_000, live = true, enabled = true, deps = [] } = options

  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Held in a ref so changing the loader between renders does not restart the
  // interval — the deps below decide that, not the identity of the closure.
  const loadRef = useRef(load)
  loadRef.current = load

  const interval = live ? every : Math.max(every, idle)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    let alive = true
    let inFlight = false
    const controller = new AbortController()

    async function tick() {
      // A slow request must not stack up behind itself. On a repository with
      // twenty sessions the list endpoint spawns git per session, and a poll
      // that overlaps turns that into a queue nothing ever drains.
      if (inFlight) return
      inFlight = true
      try {
        const result = await loadRef.current(controller.signal)
        if (!alive) return
        setData(result)
        setError(null)
      } catch (e) {
        if (!alive || isAbort(e)) return
        setError(describeError(e))
      } finally {
        inFlight = false
        if (alive) setLoading(false)
      }
    }

    void tick()
    const timer = setInterval(tick, interval)

    return () => {
      alive = false
      controller.abort()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval, enabled, nonce, ...deps])

  return {
    data,
    error,
    loading,
    stale: Boolean(error && data),
    refresh: useCallback(() => setNonce(n => n + 1), []),
  }
}

export interface ActionState {
  /** Whether this particular action is in the air. */
  busy: (key?: string) => boolean
  /** What is being waited on, for a spinner beside the message. */
  pending: string | null
  message: string | null
  tone: 'error' | 'info' | null
  run: (key: string, label: string | null, action: () => Promise<unknown>) => Promise<boolean>
  clear: () => void
}

/** How long a message stays up before it stops being news. */
const INFO_MS = 6_000
const ERROR_MS = 30_000

/**
 * Run something that changes state, and hold on to whether it worked.
 *
 * Keyed, and this is not a detail: one shared `busy` flag meant that running
 * the checks — which the client allows ten minutes for — silently swallowed
 * every `y`, `x` and `i` until it finished, because `run` returned early and
 * said nothing. Answering a permission prompt while the tests run is exactly
 * the thing that has to work.
 */
export function useAction(): ActionState {
  const [inFlight, setInFlight] = useState<string[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [tone, setTone] = useState<'error' | 'info' | null>(null)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    mounted.current = false
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const say = useCallback((text: string | null, next: 'error' | 'info' | null) => {
    setMessage(text)
    setTone(next)
    if (timer.current) clearTimeout(timer.current)
    if (!text) return
    // A message with no expiry is indistinguishable from a stuck app: the error
    // from a merge you abandoned five minutes ago should not still be the last
    // thing the footer says.
    timer.current = setTimeout(() => {
      if (mounted.current) {
        setMessage(null)
        setTone(null)
      }
    }, next === 'error' ? ERROR_MS : INFO_MS)
  }, [])

  const run = useCallback(async (key: string, label: string | null, action: () => Promise<unknown>) => {
    let already = false
    setInFlight((current) => {
      already = current.includes(key)
      return already ? current : [...current, key]
    })
    // Two presses of the same key are one action; two different keys are two.
    if (already) return false

    if (label) {
      setPending(label)
      say(label, 'info')
    }

    try {
      await action()
      if (mounted.current && label) {
        setPending(null)
        say(null, null)
      }
      return true
    } catch (e) {
      if (mounted.current) {
        setPending(null)
        say(describeError(e), 'error')
      }
      return false
    } finally {
      if (mounted.current) setInFlight(current => current.filter(item => item !== key))
    }
  }, [say])

  const busy = useCallback((key?: string) => (
    key ? inFlight.includes(key) : inFlight.length > 0
  ), [inFlight])

  return {
    busy,
    pending: inFlight.length ? pending : null,
    message,
    tone,
    run,
    clear: useCallback(() => say(null, null), [say]),
  }
}

/** A counter that advances while `active`, for spinners and elapsed times. */
export function useTick(active: boolean, everyMs = 200): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick(t => t + 1), everyMs)
    return () => clearInterval(timer)
  }, [active, everyMs])

  return tick
}

/**
 * A motion, decided once and obeyed by whatever has the screen.
 *
 * `5j`, `gg`, `G`, `⌃d` mean the same thing in a list of sessions and in a
 * transcript, and the only way to keep that true is to work out what was typed
 * in one place. `App` owns the keyboard and publishes; a list moves its cursor,
 * a transcript scrolls. Same vocabulary as the browser's `useShortcuts`, which
 * has one listener for the whole app for the same reason.
 */
export type Motion =
  | { kind: 'move'; delta: number }
  | { kind: 'first' }
  | { kind: 'last'; nth?: number }
  | { kind: 'half'; direction: 1 | -1 }

export interface MotionBus {
  publish: (motion: Motion) => void
  subscribe: (handler: (motion: Motion) => void) => () => void
}

export function createMotionBus(): MotionBus {
  const handlers = new Set<(motion: Motion) => void>()
  return {
    publish: (motion) => {
      // Copied before iterating: a handler that unsubscribes on the way through
      // — a view unmounting because the motion opened something — would
      // otherwise mutate the set mid-loop.
      for (const handler of [...handlers]) handler(motion)
    },
    subscribe: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

/** Obey motions while this surface has the screen. */
export function useMotions(bus: MotionBus, isActive: boolean, handler: (motion: Motion) => void) {
  const ref = useRef(handler)
  ref.current = handler

  useEffect(() => {
    if (!isActive) return
    return bus.subscribe(motion => ref.current(motion))
  }, [bus, isActive])
}

/**
 * Keep a selected index inside a list that can shrink.
 *
 * Clamped rather than wrapped, matching the browser: `5j` near the bottom
 * should stop at the bottom the way it does in a buffer, not teleport back to
 * the top.
 */
export function useSelection(
  length: number,
  bus: MotionBus,
  isActive: boolean,
  pageSize = 10,
): [number, (next: number) => void] {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(i => (length <= 0 ? 0 : Math.min(i, length - 1)))
  }, [length])

  const clamp = useCallback(
    (next: number) => Math.min(Math.max(0, length - 1), Math.max(0, next)),
    [length],
  )

  useMotions(bus, isActive && length > 0, (motion) => {
    switch (motion.kind) {
      case 'move':
        setIndex(i => clamp(i + motion.delta))
        break
      case 'first':
        setIndex(0)
        break
      case 'last':
        setIndex(motion.nth ? clamp(motion.nth - 1) : Math.max(0, length - 1))
        break
      case 'half':
        setIndex(i => clamp(i + Math.max(1, Math.floor(pageSize / 2)) * motion.direction))
        break
    }
  })

  return [index, useCallback((next: number) => setIndex(clamp(next)), [clamp])]
}

/**
 * Scrolling that counts from the bottom.
 *
 * Everything scrollable here is a transcript: output arrives at the end, so
 * "where I was" is a distance from the newest line rather than from the first.
 * Zero is the bottom, which is also what makes following live output the
 * default and holding your place the deliberate act.
 */
export function useScroll(total: number, height: number, bus: MotionBus, isActive: boolean) {
  const [offset, setOffset] = useState(0)
  const max = Math.max(0, total - height)
  const clamped = Math.min(offset, max)

  useMotions(bus, isActive, (motion) => {
    switch (motion.kind) {
      case 'move':
        // `j` is down the page, which is towards the newest line — so it
        // *reduces* the distance from the bottom.
        setOffset(o => Math.min(max, Math.max(0, o - motion.delta)))
        break
      case 'first':
        setOffset(max)
        break
      case 'last':
        setOffset(0)
        break
      case 'half':
        setOffset(o => Math.min(max, Math.max(0, o - Math.floor(height / 2) * motion.direction)))
        break
    }
  })

  return {
    offset: clamped,
    max,
    /** Lines below the window — "you are reading history, and it moved on". */
    behind: clamped,
    atBottom: clamped === 0,
    toBottom: useCallback(() => setOffset(0), []),
  }
}

/**
 * The keys that make up a count or a chord, and what they add up to.
 *
 * Shown while half-typed, because a `g` that leaves no trace looks exactly like
 * an app that dropped the keypress — the browser learned that one too.
 */
export function usePendingKeys(timeoutMs = 900) {
  const [pending, setPending] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    setPending('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const push = useCallback((key: string) => {
    setPending(current => current + key)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPending(''), timeoutMs)
  }, [timeoutMs])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  /** The count typed in front of a motion, consumed by reading it. */
  const takeCount = useCallback((fallback = 1) => {
    const digits = pending.match(/^\d+/)?.[0]
    clear()
    return digits ? Number(digits) : fallback
  }, [pending, clear])

  return useMemo(
    () => ({ pending, push, clear, takeCount }),
    [pending, push, clear, takeCount],
  )
}
