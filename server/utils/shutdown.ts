/**
 * Cleaning up things that outlive this process.
 *
 * Nitro's `close` hook covers a graceful shutdown and nothing else. A plain
 * `kill` — which is what a service manager sends, and what anybody stopping
 * this from a terminal sends — never reaches it.
 *
 * That is survivable for most state, and not for child processes started
 * **detached**. Previews are, deliberately: stopping a dev server means
 * signalling its whole process group, which needs the child to lead one. The
 * cost is that it does not die with its parent, so a preview left running when
 * the app was killed kept its port forever. Found by killing the server with a
 * preview up and watching `node server.js` outlive it by a minute and a half.
 *
 * Node's default action for these signals is to exit. Adding a listener
 * *replaces* that default, so anything registering one takes on the job of
 * exiting — which is why this is one shared place rather than a handler per
 * plugin, each unaware of the others.
 */

type Task = () => void

const tasks: Task[] = []
let installed = false

/** Exit codes conventional for dying to a signal: 128 + the signal number. */
const EXIT_CODES: Record<string, number> = { SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }

export function runShutdownTasks(): void {
  // Drained, so a second signal cannot run the same cleanup twice.
  const pending = tasks.splice(0, tasks.length)
  for (const task of pending) {
    try {
      task()
    } catch {
      // One failing cleanup must not stop the rest, and there is nothing left
      // to report it to.
    }
  }
}

export function onShutdown(task: Task): void {
  tasks.push(task)
  if (installed) return
  installed = true

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      runShutdownTasks()
      process.exit(EXIT_CODES[signal] ?? 0)
    })
  }

  // Covers an ordinary exit, where the signal handlers never run.
  process.once('exit', runShutdownTasks)
}
