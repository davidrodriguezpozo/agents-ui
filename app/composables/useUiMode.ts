export type UiMode = 'simple' | 'advanced'

const STORAGE_KEY = 'agents-ui:mode'

/**
 * Simple mode hides the Claude Code authoring surface (agents, commands,
 * workflows, graph) and leads with what a non-technical person actually needs:
 * what Claude can do for them, their own skills, and installing their team's
 * tools. Nothing is removed — advanced mode brings it all back.
 */
export function useUiMode() {
  const mode = useState<UiMode>('ui-mode', () => 'simple')
  const hydrated = useState('ui-mode-hydrated', () => false)

  if (import.meta.client && !hydrated.value) {
    hydrated.value = true
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'simple' || stored === 'advanced') mode.value = stored
    } catch {
      // localStorage unavailable — keep the default
    }
  }

  const isSimple = computed(() => mode.value === 'simple')

  function setMode(next: UiMode) {
    mode.value = next
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Non-fatal: the mode just won't persist
      }
    }
  }

  function toggle() {
    setMode(mode.value === 'simple' ? 'advanced' : 'simple')
  }

  return { mode, isSimple, setMode, toggle }
}
