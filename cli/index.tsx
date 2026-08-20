import { render } from 'ink'
import { createApi } from './api'
import { StudioClient } from './client'
import { answering, baseUrlFor, connect, portFrom, serverEntry } from './connect'
import { describeError } from './errors'
import { App } from './ui/App'

function usage(): string {
  return [
    'agents-studio tui            open the terminal app',
    'agents-studio tui --port N   talk to a server on that port',
    '',
    'Connects to the local Agents Studio server, and starts one if nothing is',
    'listening. Quitting does not stop the server — rituals keep running.',
  ].join('\n')
}

async function main() {
  const argv = process.argv.slice(2).filter(arg => arg !== 'tui')
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage())
    return
  }

  if (!process.stdout.isTTY) {
    console.error('agents-studio tui needs a terminal.')
    process.exitCode = 1
    return
  }

  const port = portFrom(argv, process.env)
  const baseUrl = baseUrlFor(port)
  const entry = serverEntry(process.env)

  let started = false
  try {
    const connection = await connect({
      baseUrl,
      entry,
      onStarting: () => {
        process.stderr.write(`Nothing on :${port} — starting the server…\n`)
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
  render(<App api={api} baseUrl={baseUrl} />, {
    // console.log from anything else on the process would paint over the frame
    // and look like the list was blinking.
    patchConsole: true,
  })
}

main().catch((error) => {
  console.error(describeError(error))
  process.exitCode = 1
})
