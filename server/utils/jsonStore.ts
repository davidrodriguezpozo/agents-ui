import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * A JSON file that several things read and write at once, without losing data.
 *
 * Every store in this app is one file holding a list, mutated by read-modify-
 * write. That shape has three failure modes, and all three have bitten:
 *
 *   - Two writers interleave and the slower one writes back a snapshot taken
 *     before the other's change, silently dropping it.
 *   - A write interrupted halfway leaves a truncated file.
 *   - A file that will not parse gets reported as "empty", and the next write
 *     then makes that permanent.
 *
 * The last is the dangerous one: it turns a recoverable problem into real data
 * loss, quietly. So an unreadable file is an error here, never an empty list.
 */

/**
 * Carries the shape h3 serialises to the client, so the explanation survives
 * the trip. A generic "Server Error" here would leave someone believing their
 * rituals are gone — the precise failure is the whole point.
 */
export class JsonStoreError extends Error {
  statusCode = 500
  data: { error: string; message: string }

  constructor(message: string) {
    super(message)
    this.name = 'JsonStoreError'
    this.data = { error: 'store_unreadable', message }
  }
}

/**
 * Inside the server, throw h3's error so the explanation survives serialisation
 * — a bare Error is masked as "Server Error", which would leave someone
 * believing their rituals are gone rather than unreadable. Outside it (tests),
 * the plain error carries the same message.
 */
function storeError(message: string): Error {
  if (typeof createError === 'function') {
    return createError({
      statusCode: 500,
      statusMessage: 'Stored data unreadable',
      message,
      data: { error: 'store_unreadable', message },
    })
  }
  return new JsonStoreError(message)
}

export interface JsonStore<T> {
  read(): Promise<T>
  write(value: T): Promise<void>
  /** Serialised read-modify-write. The callback may mutate what it is given. */
  update<R>(fn: (current: T) => R | Promise<R>): Promise<R>
  path(): string
}

/**
 * Locks are keyed by path rather than by store, so two stores pointed at the
 * same file still serialise against each other.
 */
const locks = new Map<string, Promise<unknown>>()

function withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
  const previous = locks.get(key) ?? Promise.resolve()
  const run = previous.then(fn, fn)
  locks.set(key, run.then(() => {}, () => {}))
  return run
}

let tmpCounter = 0

export function defineJsonStore<T>(options: {
  /** Resolved per call, because the Claude directory can be changed at runtime. */
  path: () => string
  empty: () => T
  /** Unwrap the file's envelope and apply defaults for older records. */
  decode: (parsed: any) => T
  encode: (value: T) => unknown
  /** Named in error messages, so a failure says what the user lost. */
  label: string
}): JsonStore<T> {
  const { path: resolvePath, empty, decode, encode, label } = options

  async function read(): Promise<T> {
    const path = resolvePath()
    // Never written yet is not the same as damaged.
    if (!existsSync(path)) return empty()

    try {
      return decode(JSON.parse(await readFile(path, 'utf-8')))
    } catch (primary) {
      try {
        return decode(JSON.parse(await readFile(`${path}.bak`, 'utf-8')))
      } catch {
        throw storeError(
          `Your ${label} file is unreadable (${(primary as Error).message}) and its backup did not help. `
          + `It is at ${path}. Nothing has been overwritten — restore a snapshot from Settings, `
          + 'or move that file aside to start fresh.',
        )
      }
    }
  }

  async function write(value: T): Promise<void> {
    const path = resolvePath()
    await mkdir(dirname(path), { recursive: true })

    // Keep the last good copy before replacing it.
    if (existsSync(path)) await copyFile(path, `${path}.bak`).catch(() => {})

    // Write-then-rename: rename is atomic, so an interrupted write leaves the
    // previous file intact rather than a truncated one.
    const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`
    await writeFile(tmp, `${JSON.stringify(encode(value), null, 2)}\n`, 'utf-8')
    await rename(tmp, path)
  }

  return {
    path: resolvePath,
    read,
    write,
    update<R>(fn: (current: T) => R | Promise<R>): Promise<R> {
      return withLock(resolvePath(), async () => {
        // Re-read inside the lock: the caller's copy is already stale.
        const current = await read()
        const result = await fn(current)
        await write(current)
        return result
      })
    },
  }
}
