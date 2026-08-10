/**
 * A ZIP archive, written by hand.
 *
 * A skill is a directory, so exporting one has to produce a single file that
 * still contains a tree. That normally means a dependency, and this project
 * deliberately ships none — see the note in `package.json`. Shelling out to
 * `tar` or `zip` would work on the machines most people run this on and fail
 * quietly on the ones it doesn't, in a code path nobody exercises until they
 * try to export something.
 *
 * So: entries are **stored**, not deflated. A skill is markdown and small
 * scripts; the compression would save a few kilobytes in exchange for needing
 * `zlib` framing to be exactly right, and a stored ZIP is a format you can hold
 * in your head — three record types, all little-endian, all fixed-width but the
 * names.
 *
 * What is deliberately not implemented: Zip64 (an entry over 4GB, which a skill
 * is not), encryption, and per-entry timestamps. Everything gets the same fixed
 * 1980 stamp, which makes exporting the same skill twice produce identical
 * bytes — worth more here than a modification time nobody reads.
 */

export interface ZipEntry {
  /** Path inside the archive, always with `/` separators. */
  path: string
  /** Omitted for a directory entry. */
  data?: Buffer
}

/** The earliest instant a DOS timestamp can express: 1980-01-01 00:00:00. */
const DOS_EPOCH_TIME = 0
const DOS_EPOCH_DATE = (1 << 5) | 1

/** Bit 11 of the general-purpose flags: the name below is UTF-8. */
const FLAG_UTF8_NAMES = 0x0800

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const isDirectory = entry.data === undefined
    // A directory is a zero-length entry whose name ends in a slash. That
    // trailing slash is the only thing that marks it as one, which is why an
    // empty `scripts/` survives the round trip at all.
    const name = isDirectory ? ensureTrailingSlash(entry.path) : entry.path
    const nameBytes = Buffer.from(name, 'utf-8')
    const data = entry.data ?? Buffer.alloc(0)
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(20, 4) // version needed: 2.0
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6)
    local.writeUInt16LE(0, 8) // method 0: stored
    local.writeUInt16LE(DOS_EPOCH_TIME, 10)
    local.writeUInt16LE(DOS_EPOCH_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18) // compressed size
    local.writeUInt32LE(data.length, 22) // uncompressed size — the same, stored
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // no extra field
    nameBytes.copy(local, 30)

    locals.push(local, data)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(CENTRAL_HEADER, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8)
    central.writeUInt16LE(0, 10) // stored
    central.writeUInt16LE(DOS_EPOCH_TIME, 12)
    central.writeUInt16LE(DOS_EPOCH_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number
    central.writeUInt16LE(0, 36) // internal attributes
    // High 16 bits are the unix mode, which is what makes an extracted entry
    // still a directory or still readable. Low byte carries the DOS flag.
    //
    // `>>> 0` is not decoration: a mode shifted into the top bits overflows a
    // signed 32-bit int, and `writeUInt32LE` refuses the negative that JS
    // bitwise arithmetic hands it.
    central.writeUInt32LE(
      isDirectory ? (((0o40755 << 16) | 0x10) >>> 0) : ((0o100644 << 16) >>> 0),
      38,
    )
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)

    centrals.push(central)
    offset += local.length + data.length
  }

  const centralDirectory = Buffer.concat(centrals)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with the central directory
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // no archive comment

  return Buffer.concat([...locals, centralDirectory, end])
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

let table: Int32Array | null = null

/** The standard CRC-32, which ZIP requires per entry. */
export function crc32(buffer: Buffer): number {
  if (!table) {
    table = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let bit = 0; bit < 8; bit++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      }
      table[i] = c
    }
  }

  let crc = -1
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff]!
  }

  return (crc ^ -1) >>> 0
}
