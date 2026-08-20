import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Writable } from 'node:stream'

/**
 * Things that have to own the TTY for a moment.
 *
 * A terminal emulator inside a terminal is the one thing this app should not
 * try to be. Opening a real shell, or a real editor, means getting out of the
 * way: leave Ink's raw mode, give the child stdin and stdout, and redraw when
 * it exits. If that handshake fails, printing the path is still useful — it is
 * what you would have typed yourself.
 */

export function defaultShell(): string {
  return process.env.SHELL || '/bin/sh'
}

export function defaultEditor(): string {
  return process.env.VISUAL || process.env.EDITOR || 'vi'
}

export function runInTty(command: string, args: string[] = [], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (cwd && !existsSync(cwd)) {
      reject(new Error(`That directory is gone: ${cwd}`))
      return
    }

    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', code => resolve(code ?? 0))
  })
}

/**
 * Stop reading the terminal, and start again when the child is done.
 *
 * This is the whole reason opening a shell used to kill the app. Ink reads
 * stdin through a `readable` listener, and for a TTY `stdin.pause()` does not
 * stop the underlying read — Node only calls `readStop()` for sockets whose
 * buffer it owns, so the read stays armed no matter how paused the stream
 * claims to be. An interactive shell then puts *itself* in the foreground
 * process group, our still-armed read comes from a background group, and the
 * kernel answers one of two ways: SIGTTIN, which stops the whole job (`make
 * tui` reports "suspended (tty input)" and never comes back), or EIO, which
 * arrives as an unhandled `error` on stdin and takes the process down. Both
 * look like the terminal app vanished while you were in the shell.
 *
 * So stop the handle, and ignore the two signals and any stdin error for as
 * long as the child owns the terminal: a read that slips through should not be
 * able to end the session you were working in.
 */
export function releaseTty(stdin: NodeJS.ReadStream): () => void {
  const wasRaw = Boolean(stdin.isTTY && stdin.isRaw)
  const ignore = () => {}

  process.on('SIGTTIN', ignore)
  process.on('SIGTTOU', ignore)
  stdin.on('error', ignore)
  if (wasRaw) stdin.setRawMode(false)
  stdin.pause()
  setReading(stdin, false)

  return () => {
    // `resume()` only as a fallback, for a runtime with no handle to start —
    // one whose `pause()` did the real work. On Node it would put stdin in
    // flowing mode and eat the keypresses Ink is waiting to `read()` itself.
    if (!setReading(stdin, true)) stdin.resume()
    if (wasRaw && stdin.isTTY) stdin.setRawMode(true)
    stdin.off('error', ignore)
    process.off('SIGTTIN', ignore)
    process.off('SIGTTOU', ignore)
  }
}

interface StdinHandle {
  reading?: boolean
  readStart?: () => void
  readStop?: () => void
}

/**
 * `readStop` / `readStart` on the libuv handle behind stdin.
 *
 * Private, and reached for because the public API does not express it: for a
 * TTY, `pause()` and `resume()` move the stream's flowing state without
 * touching whether the file descriptor is being read.
 *
 * The `reading` flag has to move with it. It is how `net.Socket._read` decides
 * whether to start the read itself, so leaving it behind means the next read
 * — Ink attaching its listener again on the way back, say — starts a read that
 * is already running, and `EALREADY` arrives as an unhandled error on stdin.
 * Guarded, because a Node that stops exposing the handle should cost the shell,
 * not the app.
 */
function setReading(stdin: NodeJS.ReadStream, reading: boolean): boolean {
  const handle = (stdin as unknown as { _handle?: StdinHandle })._handle
  const method = reading ? handle?.readStart : handle?.readStop
  if (!handle || !method) return false
  try {
    handle.reading = reading
    method.call(handle)
    return true
  } catch {
    // Nothing to do about it, and saying so mid-handover would land on the
    // child's screen.
    return false
  }
}

/**
 * Open a URL without taking over the screen.
 *
 * Detached, because you should not have to quit the terminal app to look at
 * the same thing in a browser — and because waiting for `open` to exit is
 * waiting for a browser window to close.
 */
export function openUrl(url: string): void {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/**
 * Swap to the alternate screen for a child, then come back.
 *
 * Ink draws in the main buffer. Without this, a shell would start underneath
 * the last frame and leave that frame in the scrollback. The alternate screen
 * is what `less` and `vim` use for the same reason; unsupported terminals
 * ignore the sequence and you get the fallback of "the shell ran below".
 */
export async function withAlternateScreen(stdout: Writable, task: () => Promise<void>): Promise<void> {
  stdout.write('\x1b[?1049h\x1b[2J\x1b[H')
  try {
    await task()
  } finally {
    // Clear on the way back in as well. Ink erased its frame when the app
    // stepped aside, but that erase went to the alternate screen — the main
    // one still shows the frame it thinks is gone, and would keep it as
    // scrollback above the redraw.
    stdout.write('\x1b[?1049l\x1b[2J\x1b[H')
  }
}
