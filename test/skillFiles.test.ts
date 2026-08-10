import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * A skill is a directory, and this is the code that lets a request name a file
 * inside it. Same shape of risk as the workspace editor next door: the server
 * runs as you with nothing in front of it, so the tests that matter are the ones
 * where a path tries to leave.
 *
 * The rest is about SKILL.md, which is inside the directory and still must not
 * be reachable here — it has a separate save path that merges frontmatter, and a
 * second way in would be a way to strip it.
 */

let root: string
let skillDir: string
let outside: string
let files: typeof import('../server/utils/skillFiles')

beforeAll(async () => {
  files = await import('../server/utils/skillFiles')
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agents-ui-skill-'))
  skillDir = join(root, 'skills', 'code-review')
  outside = join(root, 'secrets')

  await mkdir(join(skillDir, 'references'), { recursive: true })
  await mkdir(join(skillDir, 'scripts'), { recursive: true })
  await mkdir(outside, { recursive: true })

  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: code-review\n---\n\nReview it.\n')
  await writeFile(join(skillDir, 'references', 'api.md'), '# API\n')
  await writeFile(join(skillDir, 'scripts', 'check.sh'), 'echo hi\n')
  await writeFile(join(outside, 'id_rsa'), 'PRIVATE KEY\n')
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => {})
})

describe('listing what a skill is made of', () => {
  it('finds supporting files at every depth', async () => {
    const listed = await files.listSkillFiles(skillDir)
    const paths = listed.map(f => f.path)

    expect(paths).toContain('references')
    expect(paths).toContain(join('references', 'api.md'))
    expect(paths).toContain(join('scripts', 'check.sh'))
  })

  it('leaves SKILL.md out — it has its own editor', async () => {
    const listed = await files.listSkillFiles(skillDir)
    expect(listed.map(f => f.path)).not.toContain('SKILL.md')
  })

  it('keeps a SKILL.md that is nested, which is an ordinary file', async () => {
    // Only the one at the root is the instructions. A reference that happens to
    // be called SKILL.md is content, and hiding it would be a lie about the tree.
    await writeFile(join(skillDir, 'references', 'SKILL.md'), 'an example\n')

    const listed = await files.listSkillFiles(skillDir)
    expect(listed.map(f => f.path)).toContain(join('references', 'SKILL.md'))
  })

  it('lists a directory the author left empty', async () => {
    await mkdir(join(skillDir, 'assets'))

    const listed = await files.listSkillFiles(skillDir)
    const assets = listed.find(f => f.path === 'assets')

    expect(assets?.kind).toBe('directory')
  })

  it('marks a binary file rather than offering it as text', async () => {
    await writeFile(join(skillDir, 'assets.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))

    const listed = await files.listSkillFiles(skillDir)
    expect(listed.find(f => f.path === 'assets.png')?.binary).toBe(true)
  })

  it('skips a checkout artefact a GitHub import dragged along', async () => {
    await mkdir(join(skillDir, 'node_modules', 'left-pad'), { recursive: true })
    await writeFile(join(skillDir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')

    const listed = await files.listSkillFiles(skillDir)
    expect(listed.map(f => f.path).some(p => p.includes('node_modules'))).toBe(false)
  })

  it('does not follow a symlink that leads out of the skill', async () => {
    // Listed as if it were inside, this is how a scoped tree stops being scoped.
    await symlink(outside, join(skillDir, 'escape')).catch(() => null)

    const listed = await files.listSkillFiles(skillDir)
    expect(listed.map(f => f.path)).not.toContain('escape')
  })

  it('survives a directory it cannot read', async () => {
    // A skill directory on someone's disk is not guaranteed to be readable
    // throughout, and a page that throws is worse than one missing a row.
    await expect(files.listSkillFiles(join(root, 'nope'))).resolves.toEqual([])
  })
})

describe('refusing to leave the skill directory', () => {
  it('refuses a path that climbs out', async () => {
    await expect(files.readSkillFile(skillDir, '../../secrets/id_rsa'))
      .rejects.toThrow(/outside the skill directory/i)
  })

  it('refuses one that climbs out and back down again', async () => {
    await expect(files.readSkillFile(skillDir, 'references/../../../secrets/id_rsa'))
      .rejects.toThrow(/outside the skill directory/i)
  })

  it('refuses an absolute path', async () => {
    await expect(files.readSkillFile(skillDir, '/etc/passwd'))
      .rejects.toThrow(/outside the skill directory/i)
  })

  it('refuses to write through a symlink pointing out', async () => {
    await symlink(outside, join(skillDir, 'link')).catch(() => null)

    await expect(files.writeSkillFile(skillDir, 'link/planted.txt', 'x'))
      .rejects.toThrow(/outside the skill directory/i)
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false)
  })
})

describe('SKILL.md is not reachable here', () => {
  it('refuses to read it', async () => {
    await expect(files.readSkillFile(skillDir, 'SKILL.md')).rejects.toThrow(/instructions editor/i)
  })

  it('refuses to overwrite it', async () => {
    await expect(files.writeSkillFile(skillDir, 'SKILL.md', 'clobbered')).rejects.toThrow(/instructions editor/i)

    const still = await readFile(join(skillDir, 'SKILL.md'), 'utf-8')
    expect(still).toContain('name: code-review')
  })

  it('refuses to delete it', async () => {
    await expect(files.deleteSkillFile(skillDir, 'SKILL.md')).rejects.toThrow(/instructions editor/i)
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
  })
})

describe('reading a supporting file', () => {
  it('returns its text', async () => {
    const file = await files.readSkillFile(skillDir, join('references', 'api.md'))
    expect(file.content).toBe('# API\n')
  })

  it('refuses a directory rather than returning something odd', async () => {
    await expect(files.readSkillFile(skillDir, 'references')).rejects.toThrow(/directory/i)
  })

  it('refuses a file that is not text, whatever it is called', async () => {
    // A NUL byte in a `.md`: the extension says text and the bytes do not.
    await writeFile(join(skillDir, 'references', 'sneaky.md'), Buffer.from([0x68, 0x00, 0x69]))

    await expect(files.readSkillFile(skillDir, join('references', 'sneaky.md')))
      .rejects.toThrow(/not a text file/i)
  })

  it('says so when the file is not there', async () => {
    await expect(files.readSkillFile(skillDir, 'references/missing.md')).rejects.toThrow(/not there/i)
  })
})

describe('writing a supporting file', () => {
  it('creates the directories the path needs', async () => {
    // Adding the first reference to a skill without a `references/` should not
    // be two steps.
    await files.writeSkillFile(skillDir, 'references/nested/deep.md', 'content\n')

    const written = await readFile(join(skillDir, 'references', 'nested', 'deep.md'), 'utf-8')
    expect(written).toBe('content\n')
  })

  it('writes bytes as bytes when given a Buffer', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await files.writeSkillFile(skillDir, 'assets/logo.png', png)

    const written = await readFile(join(skillDir, 'assets', 'logo.png'))
    expect(written.equals(png)).toBe(true)
  })

  it('refuses to write over a directory', async () => {
    await expect(files.writeSkillFile(skillDir, 'references', 'x')).rejects.toThrow(/directory/i)
  })
})

describe('deleting', () => {
  it('removes a file', async () => {
    await files.deleteSkillFile(skillDir, join('references', 'api.md'))
    expect(existsSync(join(skillDir, 'references', 'api.md'))).toBe(false)
  })

  it('removes a directory and what is under it', async () => {
    await files.deleteSkillFile(skillDir, 'references')
    expect(existsSync(join(skillDir, 'references'))).toBe(false)
  })

  it('refuses the skill directory itself', async () => {
    // `rm -r` on the resolved root would delete the whole skill through an
    // endpoint that only claims to remove a file from it.
    await expect(files.deleteSkillFile(skillDir, '.')).rejects.toThrow(/skill itself/i)
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true)
  })
})

describe('folder paths on the way in', () => {
  it('strips the folder the person picked', () => {
    // `webkitRelativePath` always leads with the chosen directory's name.
    const normalized = files.normalizeImportPaths([
      { path: 'code-review/SKILL.md' },
      { path: 'code-review/references/api.md' },
    ])

    expect(normalized.map(f => f.path)).toEqual(['SKILL.md', 'references/api.md'])
  })

  it('leaves loose files alone, having no shared root to remove', () => {
    // Stripping a first segment here would turn `SKILL.md` into an empty path.
    const normalized = files.normalizeImportPaths([{ path: 'SKILL.md' }, { path: 'notes.md' }])
    expect(normalized.map(f => f.path)).toEqual(['SKILL.md', 'notes.md'])
  })

  it('leaves two unrelated folders alone', () => {
    const normalized = files.normalizeImportPaths([{ path: 'a/SKILL.md' }, { path: 'b/other.md' }])
    expect(normalized.map(f => f.path)).toEqual(['a/SKILL.md', 'b/other.md'])
  })

  it('drops the litter a folder picker sweeps up', () => {
    const normalized = files.normalizeImportPaths([
      { path: 'skill/SKILL.md' },
      { path: 'skill/.DS_Store' },
      { path: 'skill/node_modules/dep/index.js' },
    ])

    expect(normalized.map(f => f.path)).toEqual(['SKILL.md'])
  })

  it('normalises the separators a Windows browser reports', () => {
    const normalized = files.normalizeImportPaths([
      { path: 'skill\\SKILL.md' },
      { path: 'skill\\references\\api.md' },
    ])

    expect(normalized.map(f => f.path)).toEqual(['SKILL.md', 'references/api.md'])
  })

  it('is empty for nothing at all', () => {
    expect(files.normalizeImportPaths(undefined)).toEqual([])
    expect(files.normalizeImportPaths([])).toEqual([])
  })
})

describe('whose files may be changed', () => {
  it('allows a skill you wrote', () => {
    expect(() => files.requireWritableSkill({ slug: 'mine', source: 'local' })).not.toThrow()
  })

  it('refuses a plugin, whose next update would undo the work', () => {
    expect(() => files.requireWritableSkill({ slug: 'theirs', source: 'plugin', pluginName: 'acme' }))
      .toThrow(/acme plugin/i)
  })

  it('refuses a GitHub import, whose next pull would do the same', () => {
    expect(() => files.requireWritableSkill({ slug: 'theirs', source: 'github' }))
      .toThrow(/GitHub import/i)
  })
})
