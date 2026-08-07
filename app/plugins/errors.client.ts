import { createDeduper, describeFailure } from '~/utils/errorReporting'

/**
 * Nothing fails in silence.
 *
 * Until this existed, a failure that nobody caught simply vanished: no toast,
 * no console entry anyone would look for, no change on screen. That produced
 * the one bug report this app has had which could not be acted on — "I clicked
 * Remove and nothing happened" — because from the outside a failed request and
 * a dead button are the same thing.
 *
 * Catching it here rather than at each call site is deliberate. There are
 * eighty places that change something, spread across composables that are right
 * to let their errors propagate and components that are supposed to catch them.
 * Any one of those can be missed, and reviewing them all again next month is
 * not a plan. This is the floor: whatever gets past everything else is still
 * seen.
 *
 * It is a safety net, not an excuse. A handled failure can say something
 * specific and useful — "could not remove that project" — and should still do
 * so. What arrives here can only be generic, which is why the wording says the
 * app failed rather than pretending to know what you were doing.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const toast = useToast()
  const shouldReport = createDeduper()

  function report(error: unknown, from: string) {
    const described = describeFailure(error)
    if (!described) return

    // Always on the console, whether or not it is shown, so a burst of the
    // same failure is still fully inspectable.
    console.error(`[${from}]`, error)

    if (!shouldReport(described.description, Date.now())) return
    toast.add({ ...described, color: 'error' })
  }

  // A promise nobody caught: the failed mutation whose component forgot a
  // `catch`, which is the case this exists for.
  window.addEventListener('unhandledrejection', (event) => {
    report(event.reason, 'unhandled')
  })

  // A component that threw while rendering or inside a handler. The page is
  // usually still usable, so this reports rather than replacing everything
  // with an error screen.
  nuxtApp.hook('vue:error', (error) => {
    report(error, 'vue')
  })
})
