import { CHORD_TIMEOUT_MS, chordTarget, isBareKey, isTerminalTarget, isTypingTarget, opensItself, rowAction } from '~/utils/shortcuts'

/**
 * One listener for the whole app.
 *
 * There were four of them — ⌘K inside the search dialog, ⌘J in the shell, ⌘S on
 * each of five editor pages, Ctrl+` in the terminal dock — each mounted with the
 * thing it drove, which is why ⌘K could not be opened by the sidebar button that
 * said ⌘K on it: the dialog owned the key and the shell owned a ref nothing
 * read. A key belongs to the app, not to the component it happens to open.
 *
 * The ⌘S ones stay where they are: saving is about the thing on screen, and a
 * global handler would have to go looking for it.
 */
export function useShortcuts() {
  const paletteOpen = useState('palette-open', () => false)
  const shortcutsOpen = useState('shortcuts-open', () => false)
  /**
   * What you have typed so far of something that is not finished — `g`, `5`,
   * `2g`, `z`. Shown, because a half-typed sequence that leaves no trace looks
   * exactly like an app that dropped your keypress.
   */
  const pendingKeys = useState<string>('shortcut-pending', () => '')

  return { paletteOpen, shortcutsOpen, pendingKeys }
}

/**
 * Rows the list keys walk through.
 *
 * Read from the DOM rather than from a registry each page keeps up to date,
 * because the pages already render their rows as links and a second source of
 * truth for "what is on screen" would be wrong on the first filter change.
 * `offsetParent` drops anything inside a collapsed section — a hidden row you
 * can arrow onto is worse than one you cannot.
 */
function visibleRows(): HTMLElement[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('main [data-row]'))
    .filter(el => el.offsetParent !== null)

  /*
   * A row inside a row is not a row. `currentRow` matches the outer one first,
   * because it contains whatever has focus, so a nested pair turns `j` into
   * "walk from this row onto its own child" — and the pages that stack lists
   * invite exactly that: a ritual on Daily opens a strip of its own runs, and a
   * plugin card holds a link to the plugin. The outer one wins, because it is
   * the thing the page is a list of.
   */
  return rows.filter(el => !rows.some(other => other !== el && other.contains(el)))
}

/** The page's scrolling element, which is `main` rather than the document. */
function scroller(): HTMLElement | null {
  return document.querySelector('main')
}

/**
 * Whether something is over the page — a dialog, a slideover, the palette.
 *
 * `j` while a modal is open should not scroll a list behind it, and the modal's
 * own keys have to win. Nuxt UI gives every one of them `role="dialog"`.
 */
function overlayOpen(): boolean {
  return Boolean(document.querySelector('[role="dialog"]'))
}

/**
 * Binds the global keys. Called once, from the shell.
 *
 * Split from `useShortcuts` so a component that only wants to open the palette
 * does not accidentally install a second listener by asking for the state.
 */
export function useShortcutBindings() {
  const { paletteOpen, shortcutsOpen, pendingKeys } = useShortcuts()
  const router = useRouter()
  const route = useRoute()
  const { isPanelOpen: chatOpen } = useChat()
  const { isSimple } = useUiMode()
  const { toggle: toggleSidebar } = useSidebar()
  const colorMode = useColorMode()

  let timer: ReturnType<typeof setTimeout> | null = null

  /** Add to the half-typed sequence and restart its patience. */
  function push(key: string) {
    pendingKeys.value += key
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { pendingKeys.value = '' }, CHORD_TIMEOUT_MS)
  }

  function clearPending() {
    pendingKeys.value = ''
    if (timer) clearTimeout(timer)
    timer = null
  }

  /**
   * The count typed in front of a motion, consumed by using it.
   *
   * `5j` is five rows down. Absent, it is one — which is what makes a bare `j`
   * and a counted one the same branch instead of two.
   */
  function takeCount(fallback = 1): number {
    const digits = pendingKeys.value.match(/^\d+/)?.[0]
    clearPending()
    return digits ? Number(digits) : fallback
  }

  /** Which row has the cursor, or -1 when the cursor is nowhere yet. */
  function currentRow(rows: HTMLElement[]): number {
    const active = document.activeElement as HTMLElement | null
    if (!active) return -1
    return rows.findIndex(row => row === active || row.contains(active))
  }

  function land(row: HTMLElement | undefined, centre = false) {
    if (!row) return
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: centre ? 'center' : 'nearest' })
  }

  /**
   * Move by `delta` rows, clamped rather than wrapped.
   *
   * Wrapping is right for a palette of eight rows and wrong for a list of
   * ninety: `5j` near the bottom should stop at the bottom, the way it does in
   * a buffer, not silently teleport you back to the top.
   */
  function moveRow(delta: number) {
    const rows = visibleRows()
    if (!rows.length) return

    const current = currentRow(rows)
    const next = current === -1
      ? (delta > 0 ? 0 : rows.length - 1)
      : Math.min(rows.length - 1, Math.max(0, current + delta))

    land(rows[next])
  }

  /** `gg` and `G`, the second of which takes a count as an absolute line. */
  function jumpRow(where: 'first' | 'last', count?: number) {
    const rows = visibleRows()
    if (!rows.length) return
    if (count && count <= rows.length) return land(rows[count - 1])
    land(rows[where === 'first' ? 0 : rows.length - 1])
  }

  /**
   * ⌃d and ⌃u.
   *
   * The cursor travels with the screen, as it does in a buffer — a half-page
   * scroll that leaves the focused row behind means the next `j` snaps you back
   * to where you started, which is the opposite of what was asked for. With no
   * rows to move through it falls back to scrolling the page, so the key still
   * does something sensible on a settings screen.
   */
  function halfPage(direction: 1 | -1) {
    const main = scroller()
    const rows = visibleRows()

    if (!main) return
    if (!rows.length) {
      main.scrollBy({ top: (main.clientHeight / 2) * direction })
      return
    }

    const height = rows[0]!.getBoundingClientRect().height || 1
    const step = Math.max(1, Math.round((main.clientHeight / 2) / height))
    moveRow(step * direction)
  }

  function handler(event: KeyboardEvent) {
    // The embedded shell gets every key, including the ones below. Somebody has
    // nvim open in there.
    if (isTerminalTarget(event.target)) return

    // ⌘K and ⌘J work from inside a text box, because they are how you leave one.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
      // ⌃k is a palette motion while the palette is up, and the palette owns it.
      if (!(event.ctrlKey && !event.metaKey && paletteOpen.value)) {
        event.preventDefault()
        shortcutsOpen.value = false
        paletteOpen.value = !paletteOpen.value
        return
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !event.altKey) {
      if (!(event.ctrlKey && !event.metaKey && paletteOpen.value)) {
        event.preventDefault()
        chatOpen.value = !chatOpen.value
        return
      }
    }

    /**
     * The jumplist, which the browser has had all along under a worse name.
     * ⌃o and ⌃i are where a vim user's hands already go for "back where I was".
     */
    if (event.ctrlKey && !event.metaKey && !overlayOpen() && !isTypingTarget(event.target)) {
      if (event.key === 'o') {
        event.preventDefault()
        router.back()
        return
      }
      if (event.key === 'i') {
        event.preventDefault()
        router.forward()
        return
      }
      if (event.key === 'd' || event.key === 'u') {
        event.preventDefault()
        halfPage(event.key === 'd' ? 1 : -1)
        return
      }
    }

    if (event.key === 'Escape') {
      const wasPending = Boolean(pendingKeys.value)
      clearPending()

      // Escape out of a box is normal mode, near enough — and it is the reason
      // every other key in here is reachable again without a mouse. Not inside a
      // dialog, where Escape means "close this" and the dialog should get it.
      const active = document.activeElement as HTMLElement | null
      if (isTypingTarget(active) && !active?.closest?.('[role="dialog"]')) {
        event.preventDefault()
        active?.blur()
        return
      }

      if (active?.closest?.('[data-row]')) active.blur()
      else if (wasPending) event.preventDefault()
      return
    }

    if (!isBareKey(event)) return
    if (isTypingTarget(event.target)) return

    // The cheatsheet closes on the key that opened it, and on `q`, because a
    // panel of vim bindings that cannot be quit like one is a joke at its own
    // expense. Above the overlay guard, since it *is* the overlay.
    if (shortcutsOpen.value && (event.key === '?' || event.key === 'q')) {
      event.preventDefault()
      shortcutsOpen.value = false
      return
    }

    // A dialog owns the keyboard while it is up. Its own Escape still works —
    // that branch is above this one.
    if (overlayOpen()) return

    // Halfway through `g…`.
    if (pendingKeys.value.endsWith('g')) {
      const count = takeCount()

      if (event.key === 'g') {
        event.preventDefault()
        jumpRow('first', count > 1 ? count : undefined)
        return
      }

      const target = chordTarget(event.key, isSimple.value)
      if (target) {
        event.preventDefault()
        if (route.path !== target.to) router.push(target.to)
      }
      return
    }

    // Halfway through `z…`.
    if (pendingKeys.value.endsWith('z')) {
      clearPending()
      if (event.key === 'z') {
        event.preventDefault()
        const rows = visibleRows()
        land(rows[currentRow(rows)], true)
      }
      return
    }

    // A count in front of a motion. A leading zero is not a count; it is a zero.
    if (/^[0-9]$/.test(event.key) && !(event.key === '0' && !pendingKeys.value)) {
      event.preventDefault()
      push(event.key)
      return
    }

    switch (event.key) {
      case 'g':
      case 'z':
        event.preventDefault()
        push(event.key)
        return

      case 'G':
        event.preventDefault()
        jumpRow('last', takeCount(0) || undefined)
        return

      case 'j':
        event.preventDefault()
        moveRow(takeCount())
        return

      case 'k':
        event.preventDefault()
        moveRow(-takeCount())
        return

      /**
       * Open what you are on.
       *
       * A row that is its own link needs none of this — the browser opens a
       * focused anchor by itself, which is why the four components that had
       * `data-row` first never needed an Enter branch. The rows that are not
       * links, because they carry a toggle and a menu of their own, name the
       * element Enter presses with `data-row-open`.
       */
      case 'Enter': {
        // Only when the row itself has focus. Tab into a control inside it and
        // that control owns its Enter: the toggle on a plugin row means to be
        // flipped, not to navigate away from what you were flipping.
        const active = document.activeElement as HTMLElement | null
        if (!active?.matches?.('[data-row]')) return

        clearPending()
        if (opensItself(active)) return

        const open = rowAction(active)
        if (!open) return

        event.preventDefault()
        open.click()
        return
      }

      case '?':
        event.preventDefault()
        clearPending()
        shortcutsOpen.value = !shortcutsOpen.value
        return

      case '/':
      case ':':
        event.preventDefault()
        clearPending()
        paletteOpen.value = true
        return

      case 'n':
        event.preventDefault()
        clearPending()
        // The composer is on Work, so this is one key for "go there and put the
        // cursor in the box" rather than a modal that would have to duplicate it.
        router.push('/work?new=1')
        return

      case 't':
        event.preventDefault()
        clearPending()
        colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
        return

      case '.':
        event.preventDefault()
        clearPending()
        toggleSidebar()
        return
    }

    // Anything else ends a half-typed sequence rather than leaving it armed.
    clearPending()
  }

  onMounted(() => document.addEventListener('keydown', handler))
  onUnmounted(() => {
    document.removeEventListener('keydown', handler)
    if (timer) clearTimeout(timer)
  })

  return { paletteOpen, shortcutsOpen, pendingKeys }
}
