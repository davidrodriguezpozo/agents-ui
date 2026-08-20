import { render } from 'ink'
import { createApi } from './api'
import { parseArgs, usage } from './args'
import { StudioClient } from './client'
import { runCommand, scopeInvocation } from './commands'
import { answering, baseUrlFor, connect, serverEntry } from './connect'
import { gitRoot } from './cwd'
import { pickDiffTool } from './diffTool'
import { createKeymap } from './keymap'
import { loadKeyOverrides } from './keys'
import { describeError } from './errors'
import { enterFullScreen } from './shell'
import { App } from './ui/App'

async function main() {
  // `tui` is still accepted as the first word for the launcher's sake, and
  // everything after it is parsed rather than dropped.
  const invocation = parseArgs(process.argv.slice(2), process.env)

  if (invocation.errors.length) {
    for (const error of invocation.errors) console.error(error)
    console.error(`\n${usage()}`)
    process.exitCode = 1
    return
  }

  if (invocation.command === 'help') {
    console.log(usage())
    return
  }

  const baseUrl = baseUrlFor(invocation.port)
  const entry = serverEntry(process.env)

  let started = false
  try {
    const connection = await connect({
      baseUrl,
      entry,
      onStarting: () => {
        process.stderr.write(`Nothing on :${invocation.port} — starting the server…\n`)
      },
    })
    started = connection.started
  } catch (error) {
    console.error(describeError(error))
    process.exitCode = 1
    return
  }

  if (started && !(await answering(baseUrl))) {
    console.error(`Started a server on ${baseUrl}, but it is not answering.`)
    process.exitCode = 1
    return
  }

  const client = new StudioClient(baseUrl)
  const api = createApi(client)

  /**
   * One row per line, and a line that fits.
   *
   * Only when a person is reading it: wrapping is the terminal's business and
   * a fifteen-line inbox that wraps to forty is unreadable, but a pipe wants
   * every character — and `--json` must not be touched at all.
   *
   * Clipped rather than run through `truncate`, which collapses whitespace and
   * would take the columns out with it.
   */
  const width = process.stdout.isTTY && !invocation.json
    ? Math.max(40, process.stdout.columns ?? 100)
    : 0
  const fit = (line: string) => (width && line.length > width ? `${line.slice(0, width - 1)}…` : line)

  if (invocation.command !== 'tui') {
    try {
      // Scoped before anything asks for a list: the repository you are standing
      // in, or `--project`, or whatever the app was last pointed at. Nothing is
      // written back, so a command cannot move the browser's floor.
      await scopeInvocation(api, invocation)
      process.exitCode = await runCommand(api, invocation, {
        out: line => process.stdout.write(`${fit(line)}\n`),
        err: line => process.stderr.write(`${fit(line)}\n`),
      })
    } catch (error) {
      console.error(describeError(error))
      process.exitCode = 1
    }
    return
  }

  if (!process.stdout.isTTY) {
    console.error('agents-studio tui needs a terminal. For a pipe, try `agents-studio work --json`.')
    process.exitCode = 1
    return
  }

  // Both read once, at the door: a person's own keys, and whatever diff
  // renderer this machine has. Neither changes while the app is open.
  const { overrides, error } = loadKeyOverrides()
  if (error) process.stderr.write(`Ignoring keys.json: ${error}\n`)

  /*
   * Entered before the first frame and left however this process ends —
   * including a crash, which would otherwise leave the terminal in the
   * alternate buffer with no way back except `reset`.
   */
  const leaveFullScreen = enterFullScreen(process.stdout)
  const onExit = () => leaveFullScreen()
  process.on('exit', onExit)
  process.on('SIGINT', () => {
    leaveFullScreen()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    leaveFullScreen()
    process.exit(0)
  })

  const app = render(
    <App
      api={api}
      baseUrl={baseUrl}
      keys={createKeymap(overrides)}
      diffTool={pickDiffTool()}
      bell={invocation.bell}
      initialFilter={invocation.only}
      initialSession={invocation.session ?? null}
      project={invocation.project ?? null}
      here={gitRoot()}
    />,
    {
      // console.log from anything else on the process would paint over the frame
      // and look like the list was blinking.
      patchConsole: true,
    },
  )

  await app.waitUntilExit()
  leaveFullScreen()
}

main().catch((error) => {
  console.error(describeError(error))
  process.exitCode = 1
})
