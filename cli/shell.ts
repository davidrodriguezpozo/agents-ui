import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * Write the instruction in a real editor.
 *
 * Instructions are prose — a paragraph, a list, a pasted stack trace — and a
 * one-line field inside a terminal app will never be good at that. `git commit`
 * settled this argument a long time ago: hand over a file, take back what was
 * saved. You get your own bindings, your own wrapping, your own everything.
 *
 * Markdown, because that is what the other end reads, and because it means no
 * comment header explaining itself: `#` is a heading here, not a comment, and a
 * file that quietly ate your first line would be worse than no help at all.
 */
export async function composeInEditor(
  draft: string,
  run: (command: string, args: string[], cwd?: string) => Promise<number> = runInTty,
): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'agents-studio-'))
  const file = join(dir, 'INSTRUCTION.md')

  try {
    writeFileSync(file, draft, 'utf8')
    const code = await run(defaultEditor(), [file])
    // A non-zero exit is how `:cq` says "forget it", and honouring that is the
    // difference between an editor and a text box that happens to be elsewhere.
    if (code !== 0) return null

    const written = readFileSync(file, 'utf8').trim()
    return written || null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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
 * Take the whole screen, and give it back on the way out.
 *
 * Ink draws in the main buffer by moving the cursor up and erasing, which is
 * right for a progress bar and wrong for a program that fills the terminal: a
 * frame the height of the window, a resize, or anything else printing to the
 * same buffer leaves residue that the next frame draws *over* rather than
 * replacing — text on top of text, columns bleeding into each other.
 *
 * `vim`, `less` and `htop` all solve this the same way, and get the same bonus:
 * quitting restores the scrollback exactly as it was, so the app leaves no
 * wreckage behind in the terminal you were working in.
 */
export function enterFullScreen(stdout: Writable): () => void {
  stdout.write('\x1b[?1049h\x1b[2J\x1b[H')
  let left = false
  return () => {
    if (left) return
    left = true
    stdout.write('\x1b[?1049l')
  }
}

/**
 * Hand the terminal to a child, then take it back.
 *
 * The app is on the alternate screen, so a child gets the main buffer — which is
 * the right one for it: `git`, `$EDITOR` and a shell all expect the scrollback
 * they were started from, and anything that wants its own full screen switches
 * for itself and switches back.
 *
 * Coming back re-enters the app's screen and clears it. Ink has meanwhile drawn
 * an empty frame (the tree is hidden while suspended), so its next write is a
 * whole one rather than a patch against something the child scribbled over.
 */
export async function withMainScreen(stdout: Writable, task: () => Promise<void>): Promise<void> {
  stdout.write('\x1b[?1049l')
  try {
    await task()
  } finally {
    stdout.write('\x1b[?1049h\x1b[2J\x1b[H')
  }
}
