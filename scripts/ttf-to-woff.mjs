#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/**
 * TrueType to WOFF 1.0, losslessly, with nothing installed.
 *
 * This exists for one file — `public/fonts/SymbolsNerdFontMono-Regular.woff`,
 * the icon glyphs the Work view's terminal falls back to when a machine has no
 * patched font of its own. A 2.5MB TTF is not a thing to serve a browser, and
 * the usual answer is WOFF2, whose Brotli font transform needs `fonttools` or
 * `woff2_compress` — a build-time toolchain this project deliberately does not
 * have.
 *
 * WOFF 1.0 needs neither. It is the same sfnt tables, each zlib-deflated, in a
 * container every browser this app runs in has supported for over a decade, and
 * `node:zlib` is already here. It gets the file to about 60% of the TTF, and
 * the server compresses it again on the way out.
 *
 * Lossless is the point: no subsetting, no re-encoding, no glyph rewriting.
 * Every table that comes out is the table that went in, which is why this is
 * fifty lines instead of a font toolchain, and why the result can be checked by
 * inflating it and comparing bytes.
 *
 * Usage: node scripts/ttf-to-woff.mjs <input.ttf> <output.woff>
 */

const [, , input, output] = process.argv

if (!input || !output) {
  console.error('usage: node scripts/ttf-to-woff.mjs <input.ttf> <output.woff>')
  process.exit(1)
}

const ttf = readFileSync(input)
const flavor = ttf.readUInt32BE(0)
const numTables = ttf.readUInt16BE(4)

const tables = []
for (let i = 0; i < numTables; i++) {
  const p = 12 + i * 16
  tables.push({
    tag: ttf.readUInt32BE(p),
    checksum: ttf.readUInt32BE(p + 4),
    offset: ttf.readUInt32BE(p + 8),
    length: ttf.readUInt32BE(p + 12),
  })
}

// The WOFF directory must be in ascending tag order; a TTF's usually already is.
tables.sort((a, b) => a.tag - b.tag)

const align4 = n => (n + 3) & ~3

/** What a reader has to allocate to rebuild the sfnt, padding included. */
const totalSfntSize = 12 + 16 * numTables + tables.reduce((n, t) => n + align4(t.length), 0)

let offset = 44 + 20 * numTables
const chunks = []

for (const table of tables) {
  const raw = ttf.subarray(table.offset, table.offset + table.length)
  const packed = deflateSync(raw, { level: 9 })

  // Stored rather than deflated when deflating made it bigger, which happens
  // on the small tables. The spec signals this by compLength === origLength.
  const data = packed.length < raw.length ? packed : raw

  table.compLength = data.length
  table.woffOffset = offset

  const padded = Buffer.alloc(align4(data.length))
  data.copy(padded)
  chunks.push(padded)
  offset += padded.length
}

const header = Buffer.alloc(44)
header.write('wOFF', 0, 'ascii')
header.writeUInt32BE(flavor, 4)
header.writeUInt32BE(offset, 8)
header.writeUInt16BE(numTables, 12)
header.writeUInt16BE(0, 14)
header.writeUInt32BE(totalSfntSize, 16)
header.writeUInt16BE(1, 20)
header.writeUInt16BE(0, 22)
// The metadata and private blocks stay empty, so their offsets and lengths are
// the zeroes the buffer was allocated with.

const directory = Buffer.alloc(20 * numTables)
tables.forEach((table, i) => {
  const p = i * 20
  directory.writeUInt32BE(table.tag, p)
  directory.writeUInt32BE(table.woffOffset, p + 4)
  directory.writeUInt32BE(table.compLength, p + 8)
  directory.writeUInt32BE(table.length, p + 12)
  directory.writeUInt32BE(table.checksum, p + 16)
})

writeFileSync(output, Buffer.concat([header, directory, ...chunks]))

const percent = Math.round((offset / ttf.length) * 100)
console.log(`${input} ${ttf.length} → ${output} ${offset} bytes (${percent}%), ${numTables} tables`)
