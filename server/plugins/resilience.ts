/**
 * Surviving a stray rejection.
 *
 * Since Node 15 an unhandled promise rejection terminates the process. For an
 * ordinary request-response server that is defensible — the request fails, a
 * supervisor restarts it, nobody notices. This is not that. Sessions run for
 * minutes, rituals fire while nobody is awake, and there is no supervisor: it
 * is a process on a laptop. One `.then` without a `.catch` anywhere in the tree
 * takes down everything that was running, and the only trace is a stack trace
 * in a terminal that has usually been closed.
 *
 * That has already happened here in the mildest possible form — a redeploy
 * killed two live sessions — and the recovery for it was written before this
 * was: interrupted runs are closed on the way back up, and an interrupted
 * ritual has its clock put back. Those exist because the process going down is
 * survivable. It should still be rare, and it should never be a surprise.
 *
 * So a rejection is logged loudly and the server keeps going. A rejected
 * promise almost never means the process is now unsound; it usually means one
 * request or one background task failed. Ending fifteen sessions over it is a
 * far worse trade than carrying on with one thing broken.
 *
 * `uncaughtException` is treated the other way round. That means a throw escaped
 * a synchronous stack, and the process really may be in an unsound state, so it
 * still goes down — just with a line saying what happened and what will be
 * picked up on restart, rather than a bare trace.
 */
export default defineNitroPlugin(() => {
  process.on('unhandledRejection', (reason) => {
    console.error('[resilience] a promise was rejected with nobody to catch it:', reason)
    console.error('[resilience] the server is still up — sessions and rituals continue.')
  })

  process.on('uncaughtException', (error) => {
    console.error('[resilience] uncaught exception — shutting down:', error)
    console.error('[resilience] on restart, runs cut off by this are closed and reported,')
    console.error('[resilience] and a ritual that lost its turn will run again shortly.')

    // Deliberately still fatal. Registering this handler is what stops Node
    // exiting by itself, so the exit has to be made explicitly.
    process.exit(1)
  })
})
