const COLLAPSED_KEY = 'agents-ui:sidebar-collapsed'

/**
 * How wide the navigation is, and whether it says anything.
 *
 * This lived inside `app.vue` as a local ref, which was fine right up until the
 * keyboard could collapse it too: a shortcut cannot toggle a value that only one
 * component can see. Shared state, one owner, and the localStorage read stays
 * where it was.
 *
 * Remembered, because a width is a preference and re-collapsing it on every load
 * is the kind of small tax that gets a feature turned off and left off.
 */
export function useSidebar() {
  const collapsed = useState('sidebar-collapsed', () => false)
  const drawerOpen = useState('sidebar-drawer-open', () => false)
  const hydrated = useState('sidebar-hydrated', () => false)

  if (import.meta.client && !hydrated.value) {
    hydrated.value = true
    try {
      collapsed.value = localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      // A blocked store costs the memory, not the control.
    }
  }

  function toggle() {
    collapsed.value = !collapsed.value
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0')
    } catch {
      // As above.
    }
  }

  /**
   * The drawer wins over the preference.
   *
   * On a phone the sidebar is a drawer you slid open on purpose, and honouring a
   * collapse there would answer that with 56px of icons — the one width that is
   * useless when you have just asked to see the navigation.
   */
  const narrow = computed(() => collapsed.value && !drawerOpen.value)

  return { collapsed, drawerOpen, narrow, toggle }
}
