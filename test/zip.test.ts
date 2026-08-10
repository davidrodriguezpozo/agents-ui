import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createZip, crc32 } from '../server/utils/zip'

const run = promisify(execFile)

/**
 * A ZIP written by hand is only correct if something that is not this code can
 * read it, so the real test is `unzip`, not a reader written from the same
 * misunderstanding of the format. Where `unzip` is not on the machine those
 * tests skip and the structural ones below still run.
 */

let root: string
let hasUnzip = false

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-zip-'))
  hasUnzip = await run('unzip', ['-v']).then(() => true).catch(() => false)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('crc32', () => {
  it('matches the known value for a known input', () => {
    // The standard check value for "123456789" — if this is wrong every archive
    // is subtly corrupt in a way only an extractor complains about.
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('is zero for nothing, which is what a directory entry carries', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
})

describe('the archive structure', () => {
  it('starts with a local file header', () => {
    const zip = createZip([{ path: 'a.txt', data: Buffer.from('hello') }])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  })

  it('ends with an end-of-central-directory record naming every entry', () => {
    const zip = createZip([
      { path: 'skill/SKILL.md', data: Buffer.from('---\nname: x\n---\n') },
      { path: 'skill/references', data: undefined },
      { path: 'skill/references/api.md', data: Buffer.from('# API\n') },
    ])

    // The record is the last 22 bytes when there is no archive comment.
    const end = zip.length - 22
    expect(zip.readUInt32LE(end)).toBe(0x06054b50)
    expect(zip.readUInt16LE(end + 10)).toBe(3)
  })

  it('marks a directory with a trailing slash, which is the only thing that does', () => {
    const zip = createZip([{ path: 'skill/scripts', data: undefined }])
    expect(zip.toString('latin1')).toContain('skill/scripts/')
  })

  it('is byte-identical for the same input twice', () => {
    // Fixed timestamps: exporting the same skill twice should not produce two
    // different files.
    const entries = [{ path: 'a.txt', data: Buffer.from('same') }]
    expect(createZip(entries).equals(createZip(entries))).toBe(true)
  })

  it('produces a valid empty archive', () => {
    const zip = createZip([])
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(0x06054b50)
  })
})

describe('what unzip makes of it', () => {
  it('extracts a skill directory with its files intact', async () => {
    if (!hasUnzip) return

    const archive = createZip([
      { path: 'code-review/SKILL.md', data: Buffer.from('---\nname: code-review\n---\n\nReview it.\n') },
      { path: 'code-review/references', data: undefined },
      { path: 'code-review/references/api.md', data: Buffer.from('# API\n') },
      { path: 'code-review/scripts/check.sh', data: Buffer.from('echo hi\n') },
    ])

    const archivePath = join(root, 'skill.zip')
    const target = join(root, 'out')
    await writeFile(archivePath, archive)
    await run('unzip', ['-q', archivePath, '-d', target])

    expect(await readFile(join(target, 'code-review', 'SKILL.md'), 'utf-8')).toContain('name: code-review')
    expect(await readFile(join(target, 'code-review', 'references', 'api.md'), 'utf-8')).toBe('# API\n')
    expect(await readFile(join(target, 'code-review', 'scripts', 'check.sh'), 'utf-8')).toBe('echo hi\n')
  })

  it('passes unzip -t, which checks every CRC', async () => {
    if (!hasUnzip) return

    const archivePath = join(root, 'crc.zip')
    await writeFile(archivePath, createZip([
      { path: 'a/one.md', data: Buffer.from('one') },
      { path: 'a/two.md', data: Buffer.from('two'.repeat(5000)) },
    ]))

    const { stdout } = await run('unzip', ['-t', archivePath])
    expect(stdout).toMatch(/No errors detected/i)
  })

  it('keeps bytes that are not text exactly as they were', async () => {
    if (!hasUnzip) return

    // A stored entry has no encoding step, so this is really a test that the
    // sizes and offsets are right — get one wrong and the bytes shift.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f])
    const archivePath = join(root, 'binary.zip')
    const target = join(root, 'binary-out')

    await writeFile(archivePath, createZip([{ path: 's/assets/logo.png', data: png }]))
    await run('unzip', ['-q', archivePath, '-d', target])

    expect((await readFile(join(target, 's', 'assets', 'logo.png'))).equals(png)).toBe(true)
  })

  /**
   * Checked with libarchive rather than `unzip`, deliberately.
   *
   * Info-ZIP 6.0 — still what macOS ships — predates the UTF-8 flag and
   * transcodes names as CP437 regardless, so it fails on an accented filename
   * that is perfectly well formed. Asserting against it would mean either a
   * failing test or writing worse names to satisfy a 2009 extractor.
   */
  it('keeps a non-ASCII filename readable', async () => {
    const hasBsdtar = await run('bsdtar', ['--version']).then(() => true).catch(() => false)
    if (!hasBsdtar) return

    const archivePath = join(root, 'utf8.zip')
    const target = join(root, 'utf8-out')

    await writeFile(archivePath, createZip([{ path: 's/référence.md', data: Buffer.from('ok') }]))
    await run('bsdtar', ['-xf', archivePath, '-C', await ensure(target)])

    expect(await readFile(join(target, 's', 'référence.md'), 'utf-8')).toBe('ok')
  })
})

async function ensure(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  return dir
}
