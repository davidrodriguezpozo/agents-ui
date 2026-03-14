export function useUnsavedChanges(isDirty: Ref<boolean> | ComputedRef<boolean>) {
  if (!import.meta.client) return

  const handler = (e: BeforeUnloadEvent) => {
    if (isDirty.value) {
      e.preventDefault()
    }
  }

  onMounted(() => window.addEventListener('beforeunload', handler))
  onUnmounted(() => window.removeEventListener('beforeunload', handler))
}
