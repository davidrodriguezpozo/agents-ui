const OPEN_KEY = 'agents-ui:rail-open'

/**
 * How wide the rail is. Not adjustable, on purpose.
 *
 * A session title is the thing you scan, and the rail is sized so that the first
 * five or six words of one fit. Narrower and every row truncates to the same
 * prefix — "Fix the flaky…", "Fix the rounding…" — which is a list of rows you
 * cannot tell apart. Wider and it starts competing with the pane, which is where
 * the work actually is.
 */
export const RAIL_WIDTH = 264

/**
 * Whether the session rail is showing, and the key that changes it.
 *
 * Remembered, for the same reason the sidebar's collapsed state and the
 * terminal's height are: a panel you have to reopen on every load is one that
 * gets opened twice and then left closed.
 *
 * `useState` rather than a module-level ref so the rail, the header button that
 * hides it and the keyboard handler are all looking at one value — and so it
 * survives navigating from the work page into a session, which is the whole
 * point of the rail existing.
 */
export function useWorkRail() {
  /**
   * Open by default. The rail is the navigation for this half of the app, so a
   * first run that hides it is a first run where hopping between sessions is
   * still the four clicks this replaced.
   */
  const open = useState<boolean>('work-rail-open', () => true)
  const loaded = useState<boolean>('work-rail-loaded', () => false)

  /**
   * Whether the rail is over the pane rather than beside it, which is what it
   * does on a window too narrow to hold both. Not persisted — it is a fact
   * about the window, decided by the media query in `layouts/work.vue`, and a
   * remembered answer would be the previous window's.
   */
  const drawerOpen = useState<boolean>('work-rail-drawer', () => false)

  if (import.meta.client && !loaded.value) {
    loaded.value = true
    try {
      const stored = localStorage.getItem(OPEN_KEY)
      if (stored !== null) open.value = stored === '1'
    } catch {
      // A blocked store costs the memory, not the control.
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

  return { open: readonly(open), drawerOpen, width: RAIL_WIDTH, setOpen, toggle }
}

/**
 * Which of its two jobs the Work page is doing.
 *
 * Deliberately not `WorkTab`. That type is a fact about the *work* — whether a
 * piece of it is in flight or settled — and it is what `railGroups` and the
 * status chips read. This is a fact about the screen: the rail took the in-flight
 * rows, so what is left in the pane is starting something and reading what
 * finished. Fusing the two is what left the page with a tab called "In flight"
 * that had no in-flight rows on it.
 *
 * Shared state so the rail's History button and the page's own strip are the same
 * control, and so coming back from a session lands on the view you left.
 */
export function useWorkPane() {
  const pane = useState<'start' | 'history'>('work-pane', () => 'start')
  return { pane }
}
