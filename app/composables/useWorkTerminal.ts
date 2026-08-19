const OPEN_KEY = 'agents-ui:terminal-open'
const HEIGHT_KEY = 'agents-ui:terminal-height'

/** Small enough to be a strip, large enough for `git log` to be worth reading. */
const MIN_HEIGHT = 140
const MAX_HEIGHT = 900
const DEFAULT_HEIGHT = 320

/**
 * Whether the Work view's shell is open, and how tall.
 *
 * Both are remembered. A terminal you have to reopen and resize on every load
 * is one that gets opened twice and then left closed — the same tax the
 * sidebar's collapsed state exists to avoid.
 *
 * `useState` rather than a module-level ref so the dock and the button in the
 * page header are looking at the same value, and so it survives navigating to a
 * session and back without the shell being reattached from scratch.
 */
export function useWorkTerminal() {
  const open = useState<boolean>('work-terminal-open', () => false)
  const height = useState<number>('work-terminal-height', () => DEFAULT_HEIGHT)
  const loaded = useState<boolean>('work-terminal-loaded', () => false)

  if (import.meta.client && !loaded.value) {
    loaded.value = true
    try {
      open.value = localStorage.getItem(OPEN_KEY) === '1'
      const stored = Number(localStorage.getItem(HEIGHT_KEY))
      if (Number.isFinite(stored) && stored > 0) height.value = clampHeight(stored)
    } catch {
      // A blocked store costs the memory, not the control.
    }
  }

  function clampHeight(value: number): number {
    return Math.max(MIN_HEIGHT, Math.min(Math.round(value), MAX_HEIGHT))
  }

  function setHeight(value: number) {
    height.value = clampHeight(value)
    try {
      localStorage.setItem(HEIGHT_KEY, String(height.value))
    } catch {
      // As above.
    }
  }

  function setOpen(value: boolean) {
    open.value = value
    try {
      localStorage.setItem(OPEN_KEY, value ? '1' : '0')
    } catch {
      // As above.
    }
  }

  function toggle() {
    setOpen(!open.value)
  }

  /**
   * Ctrl-` opens it, which is the shortcut every editor with a terminal uses.
   *
   * Deliberately not ⌘-anything: a shell claims most of those, and this is a
   * chord that has to keep working while the shell has focus. It is registered
   * by whoever calls this — there is no shortcut registry in this app, and a
   * `document` listener owned by the component that needs it is the convention
   * everything else here already follows.
   */
  function bindShortcut() {
    if (!import.meta.client) return

    const handler = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) return
      // `code` rather than `key`: with Ctrl held, some layouts report a dead key
      // or a control character where the backquote should be.
      if (event.code !== 'Backquote' && event.key !== '`') return

      event.preventDefault()
      toggle()
    }

    onMounted(() => document.addEventListener('keydown', handler))
    onUnmounted(() => document.removeEventListener('keydown', handler))
  }

  return {
    open: readonly(open),
    height: readonly(height),
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
    setOpen,
    setHeight,
    toggle,
    bindShortcut,
  }
}
