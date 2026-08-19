import { EventEmitter } from 'node:events'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * A real shell in a session's workspace.
 *
 * The second reason people leave: trying something by hand. It is the largest
 * of the absorb steps and the one that collided with a property this project
 * protects — `package.json` has no runtime dependencies and nothing compiles at
 * install time, which rules out `node-pty`.
 *
 * So the pty comes from Python, the way `mcp.ts` already gets one. `pty.spawn`
 * was not enough on its own: it keeps the master descriptor to itself, so the
 * child is stuck at 80x24 forever and a terminal you cannot resize is a poor
 * imitation of one. `os.openpty` hands the master back, which makes
 * `TIOCSWINSZ` possible and lets the child take `SIGWINCH` as it would in a
 * real terminal. Proven before any of this was written: interactive prompt,
 * writes after start, incremental streaming, a genuine tty, and 80 → 160 → 60
 * columns on demand.
 *
 * **This is not sandboxed, deliberately.** The sandbox exists for work nobody
 * is watching; a person typing into their own shell, in their own checkout, on
 * their own machine is the thing the sandbox was protecting *from* being
 * impersonated, not the thing it protects against. Anything typed here runs as
 * you, exactly as it would in Terminal.app.
 */

/**
 * Embedded rather than shipped as a file. Nitro bundles the server into
 * `.output`, and a stray `.py` beside the TypeScript is not part of that — it
 * would work in dev and be missing from every install. `mcp.ts` embeds its
 * spawn helper for the same reason.
 */
const PTY_SCRIPT = [
  'import os, pty, select, signal, struct, sys, fcntl, termios, subprocess, base64',
  'master, slave = pty.openpty()',
  'def set_size(c, r):',
  '    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))',
  'set_size(80, 24)',
  'shell = os.environ.get("SHELL") or "/bin/bash"',
  'child = subprocess.Popen([shell, "-i"], stdin=slave, stdout=slave, stderr=slave,',
  '                        preexec_fn=os.setsid, env={**os.environ, "TERM": "xterm-256color"})',
  'os.close(slave)',
  'buf = b""',
  'while child.poll() is None:',
  '    try:',
  '        ready, _, _ = select.select([master, sys.stdin.buffer], [], [], 0.1)',
  '    except (OSError, ValueError):',
  '        break',
  '    if master in ready:',
  '        try:',
  '            data = os.read(master, 65536)',
  '        except OSError:',
  '            break',
  '        if not data:',
  '            break',
  '        sys.stdout.buffer.write(data)',
  '        sys.stdout.buffer.flush()',
  '    if sys.stdin.buffer in ready:',
  '        chunk = os.read(sys.stdin.buffer.fileno(), 65536)',
  '        if not chunk:',
  '            break',
  '        buf += chunk',
  '        while b"\\n" in buf:',
  '            line, buf = buf.split(b"\\n", 1)',
  '            if not line:',
  '                continue',
  '            kind, payload = line[:1], line[1:]',
  '            try:',
  '                raw = base64.b64decode(payload)',
  '            except Exception:',
  '                continue',
  '            if kind == b"r":',
  '                try:',
  '                    c, r = raw.decode().split(",")',
  '                    set_size(int(c), int(r))',
  '                    child.send_signal(signal.SIGWINCH)',
  '                except Exception:',
  '                    pass',
  '            elif kind == b"d":',
  '                os.write(master, raw)',
  'try:',
  '    child.terminate()',
  'except Exception:',
  '    pass',
  'sys.exit(0)',
].join('\n')

/**
 * Enough to redraw the screen for whoever attaches next, and no more. A shell
 * left running `yes` would otherwise grow this without limit.
 */
const SCROLLBACK_LIMIT = 200_000

/** A terminal nobody has been attached to for this long is closed. */
export const IDLE_TIMEOUT_MS = 30 * 60_000

export interface TerminalSession {
  id: string
  child: ChildProcessWithoutNullStreams
  emitter: EventEmitter
  /** What has been printed, trimmed, so a reattach can redraw. */
  scrollback: string
  attached: number
  lastActivity: number
  exited?: number
}

const terminals = new Map<string, TerminalSession>()

/**
 * Every message is `<kind><base64>\n`.
 *
 * A terminal carries bytes, not lines: `ls` with no Enter must stay unsent,
 * Ctrl-C is a bare `\x03`, and an arrow key is an escape sequence with no
 * newline anywhere in it. A line-delimited protocol cannot express any of
 * those, so the payload is base64 — which never contains a newline, making the
 * framing safe — and the byte stream arrives at the pty exactly as typed.
 */
function send(session: TerminalSession, kind: 'd' | 'r', payload: string): void {
  if (session.exited !== undefined) return

  /**
   * Guarded, because the `exited` check above is a race it cannot win.
   *
   * That flag is only set once Node delivers `'exit'`, and a keystroke — or the
   * pane's own resize — can arrive in the window between the shell dying and
   * that event landing. The write then hits a closed pipe and the stream emits
   * `'error'`. An unhandled `'error'` on a stream *throws*, which would take
   * down the whole server: every run in flight, every preview, and every other
   * session's shell, because one shell exited a few milliseconds early.
   */
  try {
    session.child.stdin.write(`${kind}${Buffer.from(payload, 'utf-8').toString('base64')}\n`)
  } catch {
    // The shell has gone. The `'exit'` handler will mark it; there is nothing
    // useful to say about a keystroke that arrived a moment too late.
    return
  }

  session.lastActivity = Date.now()
}

export function getTerminal(id: string): TerminalSession | undefined {
  return terminals.get(id)
}

export function startTerminal(id: string, cwd: string): TerminalSession {
  const existing = terminals.get(id)
  if (existing && existing.exited === undefined) return existing

  const child = spawn('python3', ['-c', PTY_SCRIPT], {
    cwd: existsSync(cwd) ? cwd : process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    /**
     * `TERM` so programs know what they are drawing to, and two more that
     * decide whether the result is legible.
     *
     * A prompt like powerlevel10k or starship draws its separators and icons
     * from the Private Use Area — multi-byte characters that a shell inheriting
     * a non-UTF-8 `LANG` mangles before xterm ever sees them, which reads as
     * "the font is wrong" when the font is fine. The launcher is a background
     * service and may well have been started without a locale at all, so this
     * fills one in rather than trusting what it was handed. Only when absent:
     * somebody who has set `LANG` has set it for a reason.
     *
     * `COLORTERM` is what 24-bit colour is gated on in most tools; without it
     * they fall back to 256 and a theme picked in truecolor comes out
     * approximated.
     */
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      LANG: process.env.LANG || 'en_US.UTF-8',
    },
  })

  const session: TerminalSession = {
    id,
    child,
    emitter: new EventEmitter(),
    scrollback: '',
    attached: 0,
    lastActivity: Date.now(),
  }

  const onData = (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    session.scrollback = (session.scrollback + text).slice(-SCROLLBACK_LIMIT)
    session.lastActivity = Date.now()
    session.emitter.emit('data', text)
  }

  child.stdout.on('data', onData)
  // Python's own errors matter here: a machine with no python3 fails at spawn,
  // and one with an unusual environment fails inside the script. Both are far
  // more useful shown in the terminal than swallowed.
  child.stderr.on('data', onData)

  /**
   * The listeners that stop a dead shell taking the server with it.
   *
   * `write()` on a broken pipe rarely throws — it emits `'error'` on the stream
   * asynchronously, and an unhandled `'error'` event throws at the top level.
   * The try/catch around the write cannot catch that, so these are not
   * belt-and-braces: they are the part that does the work.
   */
  for (const pipe of [child.stdin, child.stdout, child.stderr]) {
    pipe.on('error', () => {
      // EPIPE on a shell that has just exited, which is ordinary and already
      // reported by the `'exit'` handler below.
    })
  }

  child.on('exit', (code) => {
    session.exited = code ?? 0
    session.emitter.emit('exit', session.exited)
  })

  child.on('error', (e) => {
    const message = `\r\n[could not start a shell: ${e.message}]\r\n`
    session.scrollback += message
    session.emitter.emit('data', message)
    session.exited = 1
    session.emitter.emit('exit', 1)
  })

  terminals.set(id, session)
  return session
}

/**
 * Passed through byte for byte. Nothing typed can be mistaken for a control
 * message, because the two travel as different kinds rather than being told
 * apart by their content.
 */
export function sendInput(id: string, data: string): boolean {
  const session = terminals.get(id)
  if (!session || session.exited !== undefined) return false

  send(session, 'd', data)
  return true
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = terminals.get(id)
  if (!session || session.exited !== undefined) return false

  // Clamped: a pane reporting nonsense mid-layout should not ask the kernel
  // for a 60000-column terminal.
  const c = Math.max(20, Math.min(Math.floor(cols) || 80, 500))
  const r = Math.max(5, Math.min(Math.floor(rows) || 24, 200))
  send(session, 'r', `${c},${r}`)
  return true
}

export function stopTerminal(id: string): void {
  const session = terminals.get(id)
  if (!session) return

  try {
    session.child.kill('SIGTERM')
  } catch {
    // Already gone, which is the outcome asked for.
  }
  terminals.delete(id)
}

/**
 * Close terminals nobody is watching.
 *
 * A shell holds a process, a pty and a scrollback buffer for as long as it
 * lives. Leaving one per session that was opened once, weeks ago, is how a
 * background service quietly becomes the reason a laptop is warm.
 */
export function reapIdleTerminals(now = Date.now()): number {
  let closed = 0
  for (const [id, session] of terminals) {
    if (session.attached > 0) continue
    if (now - session.lastActivity < IDLE_TIMEOUT_MS) continue
    stopTerminal(id)
    closed++
  }
  return closed
}

/** Everything, on shutdown — an orphaned pty outlives the server otherwise. */
export function stopAllTerminals(): void {
  for (const id of [...terminals.keys()]) stopTerminal(id)
}
