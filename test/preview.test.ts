import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Starting somebody's dev server, and — more importantly — stopping it again.
 *
 * The failure that matters is not a server that will not start. It is a server
 * that will not stop: a dev command is a shell running a package manager
 * running the real thing, so killing the shell alone leaves the server holding
 * the port, and every restart leaks another one.
 */

let dir: string
let preview: typeof import('../server/utils/preview')

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-preview-'))
  process.env.CLAUDE_DIR = dir
  preview = await import('../server/utils/preview')
})

afterEach(async () => {
  preview.stopAllPreviews()
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  delete process.env.CLAUDE_DIR
})

describe('guessing how a project runs', () => {
  it('prefers a dev script to a start script', async () => {
    // `start` is as often "run the built thing" as "run it for development",
    // and the second is what somebody reviewing a session wants.
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      scripts: { dev: 'vite', start: 'node server.js' },
    }))

    expect(preview.detectDevCommand(dir)?.command).toBe('npm run dev')
  })

  it('falls back to start when that is all there is', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { start: 'node s.js' } }))

    expect(preview.detectDevCommand(dir)?.command).toBe('npm run start')
  })

  it('reads the package manager off the lockfile', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    await writeFile(join(dir, 'pnpm-lock.yaml'), '')

    expect(preview.detectDevCommand(dir)?.command).toBe('pnpm run dev')
  })

  it('prefers a Makefile target, which is the project saying so itself', async () => {
    await writeFile(join(dir, 'Makefile'), 'dev:\n\techo hi\n')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))

    expect(preview.detectDevCommand(dir)?.command).toBe('make dev')
  })

  it('guesses nothing rather than something wrong', async () => {
    expect(preview.detectDevCommand(dir)).toBeNull()
  })

  it('remembers being told this project has nothing to run', async () => {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }))
    await preview.setDevCommand(dir, '')

    // An empty command is a real answer, and stops the guess applying.
    await expect(preview.devCommandFor(dir)).resolves.toBeNull()
  })
})

describe('picking a port', () => {
  it('gives one nothing is listening on', async () => {
    const port = await preview.freePort()

    expect(port).toBeGreaterThan(1023)
    expect(await preview.portAnswers(port, 300)).toBe(false)
  })

  it('does not hand the same one out twice in a row', async () => {
    // Two sessions starting together must not be given the same port.
    const [a, b] = await Promise.all([preview.freePort(), preview.freePort()])
    expect(a).not.toBe(b)
  })
})

describe('running one', () => {
  it('reaches ready once something answers, and reports the port', async () => {
    const script = join(dir, 'serve.js')
    await writeFile(script, `require('http').createServer((_,res)=>res.end('ok')).listen(process.env.PORT)`)

    const p = await preview.startPreview('s1', dir, `node ${script}`)
    expect(p.state).toBe('starting')

    for (let i = 0; i < 40 && preview.getPreview('s1')?.state === 'starting'; i++) await wait(150)

    expect(preview.getPreview('s1')?.state).toBe('ready')
    expect(await preview.portAnswers(p.port, 500)).toBe(true)
  }, 20_000)

  it('stops the server, not just the shell that started it', async () => {
    // The failure this exists to prevent: killing the shell leaves the real
    // server holding the port, and every restart leaks another one.
    const script = join(dir, 'serve.js')
    await writeFile(script, `require('http').createServer((_,res)=>res.end('ok')).listen(process.env.PORT)`)

    const p = await preview.startPreview('s2', dir, `node ${script}`)
    for (let i = 0; i < 40 && preview.getPreview('s2')?.state === 'starting'; i++) await wait(150)
    expect(preview.getPreview('s2')?.state).toBe('ready')

    preview.stopPreview('s2')
    for (let i = 0; i < 30 && await preview.portAnswers(p.port, 200); i++) await wait(150)

    expect(await preview.portAnswers(p.port, 400)).toBe(false)
    expect(preview.getPreview('s2')).toBeUndefined()
  }, 25_000)

  it('calls a command that exits immediately a failure, and keeps why', async () => {
    const p = await preview.startPreview('s3', dir, 'echo nope && exit 3')

    for (let i = 0; i < 30 && preview.getPreview('s3')?.state === 'starting'; i++) await wait(150)

    const after = preview.getPreview('s3')!
    expect(after.state).toBe('failed')
    expect(after.output).toContain('nope')
    expect(p.port).toBeGreaterThan(0)
  }, 20_000)

  /**
   * As close to the brief's by-hand step as a session without a browser gets:
   * a real dev server, started the real way, and the page the iframe would load
   * with the element picker already in it. What is left is the click.
   */
  it('serves the same page on the picker port, with the picker added to it', async () => {
    const script = join(dir, 'serve.js')
    await writeFile(script, `require('http').createServer((_,res)=>{`
      + `res.writeHead(200,{'content-type':'text/html'});`
      + `res.end('<html><head></head><body><button class="btn">Run it</button></body></html>')`
      + `}).listen(process.env.PORT)`)

    const p = await preview.startPreview('s5', dir, `node ${script}`)
    for (let i = 0; i < 40 && preview.getPreview('s5')?.state === 'starting'; i++) await wait(150)
    expect(preview.getPreview('s5')?.state).toBe('ready')

    expect(p.pickerPort).toBeGreaterThan(0)
    expect(p.pickerPort).not.toBe(p.port)

    const body = await fetch(`http://127.0.0.1:${p.pickerPort}/`).then(r => r.text())
    expect(body).toContain('<button class="btn">Run it</button>')
    expect(body).toContain('__agents_ui_element_picker.js')
  }, 20_000)

  it('lets go of the picker port when the preview stops', async () => {
    const script = join(dir, 'serve.js')
    await writeFile(script, `require('http').createServer((_,res)=>res.end('ok')).listen(process.env.PORT)`)

    const p = await preview.startPreview('s6', dir, `node ${script}`)
    for (let i = 0; i < 40 && preview.getPreview('s6')?.state === 'starting'; i++) await wait(150)
    // Read before stopping: stopping clears it off the record.
    const pickerPort = p.pickerPort!
    expect(pickerPort).toBeGreaterThan(0)

    preview.stopPreview('s6')
    for (let i = 0; i < 20 && await preview.portAnswers(pickerPort, 200); i++) await wait(150)

    expect(await preview.portAnswers(pickerPort, 400)).toBe(false)
  }, 25_000)

  it('replaces a running one rather than starting a second', async () => {
    const script = join(dir, 'serve.js')
    await writeFile(script, `require('http').createServer((_,res)=>res.end('ok')).listen(process.env.PORT)`)

    const first = await preview.startPreview('s4', dir, `node ${script}`)
    for (let i = 0; i < 40 && preview.getPreview('s4')?.state === 'starting'; i++) await wait(150)

    const second = await preview.startPreview('s4', dir, `node ${script}`)
    expect(second.port).not.toBe(first.port)

    for (let i = 0; i < 30 && await preview.portAnswers(first.port, 200); i++) await wait(150)
    expect(await preview.portAnswers(first.port, 400)).toBe(false)
  }, 30_000)
})
