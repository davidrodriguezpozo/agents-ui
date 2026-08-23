import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Utils reach for Nitro's auto-imported createError; these tests run outside it.
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)

/**
 * Writing this app into somebody's `.mcp.json`.
 *
 * Two things could do real damage here and both are tested first: the entry
 * carries a bearer token, so a *tracked* file must be refused rather than
 * written to; and the file is usually the team's, listing servers that have
 * nothing to do with this app, so everything that is not ours must survive
 * untouched.
 */

let repo: string
let claudeDir: string
let connect: typeof import('../server/utils/mcpConnect')

const URL = 'http://127.0.0.1:3000/api/mcp/rpc'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'agents-ui-mcp-cfg-'))
  process.env.CLAUDE_DIR = claudeDir
  repo = await mkdtemp(join(tmpdir(), 'agents-ui-mcp-repo-'))

  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@e.com')
  git(repo, 'config', 'user.name', 'T')

  const claude = await import('../server/utils/claudeDir')
  claude.setClaudeDir(claudeDir)
  connect = await import('../server/utils/mcpConnect')
})

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true })
  await rm(repo, { recursive: true, force: true })
})

const configPath = () => join(repo, '.mcp.json')

describe('a tracked config', () => {
  it('is refused, because the entry carries a token', async () => {
    await writeFile(configPath(), '{ "mcpServers": {} }\n', 'utf8')
    git(repo, 'add', '.mcp.json')
    git(repo, 'commit', '-q', '-m', 'the team config')

    const result = await connect.connectProject(repo, URL)

    expect(result.ok).toBe(false)
    expect(result.refusal?.error).toBe('tracked')
    expect(result.refusal?.message).toContain('secret in your next commit')
    // Refused, not written-then-warned: by the time a warning is read the token
    // would already be in the index.
    expect(await readFile(configPath(), 'utf8')).toBe('{ "mcpServers": {} }\n')
  })

  it('names both ways forward rather than only saying no', async () => {
    await writeFile(configPath(), '{}\n', 'utf8')
    git(repo, 'add', '.mcp.json')
    git(repo, 'commit', '-q', '-m', 'tracked')

    const { refusal } = await connect.connectProject(repo, URL)

    expect(refusal?.message).toContain('by hand')
    expect(refusal?.message).toContain('untrack')
  })
})

describe('writing it', () => {
  it('creates the file and excludes it from this clone', async () => {
    const result = await connect.connectProject(repo, URL)

    expect(result).toMatchObject({ ok: true, created: true, excluded: true })

    const written = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(written.mcpServers['agents-studio']).toMatchObject({ type: 'http', url: URL })
    expect(written.mcpServers['agents-studio'].headers.Authorization).toMatch(/^Bearer .+/)

    // The point of excluding: a `git add .` by anybody cannot stage the token.
    git(repo, 'add', '.')
    expect(git(repo, 'status', '--porcelain')).toBe('')
  })

  it('leaves every other server exactly as it was', async () => {
    await writeFile(configPath(), JSON.stringify({
      mcpServers: {
        slack: { command: 'npx', args: ['-y', 'slack-mcp'] },
        notion: { type: 'http', url: 'https://example.invalid/notion' },
      },
      somethingElse: { kept: true },
    }, null, 2), 'utf8')

    const result = await connect.connectProject(repo, URL)
    const written = JSON.parse(await readFile(configPath(), 'utf8'))

    expect(result).toMatchObject({ ok: true, created: false })
    expect(result.kept?.sort()).toEqual(['notion', 'slack'])
    expect(written.mcpServers.slack).toEqual({ command: 'npx', args: ['-y', 'slack-mcp'] })
    expect(written.mcpServers.notion.url).toBe('https://example.invalid/notion')
    // Keys outside `mcpServers` are somebody else's business too.
    expect(written.somethingElse).toEqual({ kept: true })
  })

  it('replaces our own entry rather than adding a second one', async () => {
    await connect.connectProject(repo, URL)
    const result = await connect.connectProject(repo, 'http://127.0.0.1:3001/api/mcp/rpc')

    const written = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(result).toMatchObject({ ok: true, replaced: true })
    expect(Object.keys(written.mcpServers)).toEqual(['agents-studio'])
    expect(written.mcpServers['agents-studio'].url).toBe('http://127.0.0.1:3001/api/mcp/rpc')
  })

  it('adds the exclude entry once, however many times it runs', async () => {
    await connect.connectProject(repo, URL)
    await connect.connectProject(repo, URL)

    const exclude = await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter(line => line.trim() === '.mcp.json')).toHaveLength(1)
  })

  it('writes something a person can read and diff', async () => {
    await connect.connectProject(repo, URL)
    const text = await readFile(configPath(), 'utf8')

    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "mcpServers"')
  })
})

describe('a config it cannot understand', () => {
  it('is left alone rather than replaced', async () => {
    const broken = '{ "mcpServers": { "slack": }\n'
    await writeFile(configPath(), broken, 'utf8')

    const result = await connect.connectProject(repo, URL)

    expect(result.ok).toBe(false)
    expect(result.refusal?.error).toBe('unreadable')
    expect(await readFile(configPath(), 'utf8')).toBe(broken)
  })

  it('refuses a file that is not an object', async () => {
    expect(connect.mergeConfig('[1,2,3]', URL, 't')).toMatchObject({
      refusal: expect.stringContaining('JSON object'),
    })
  })

  it('refuses a config whose mcpServers is not an object', async () => {
    expect(connect.mergeConfig('{ "mcpServers": true }', URL, 't')).toMatchObject({
      refusal: expect.stringContaining('not an object'),
    })
  })

  it('treats an empty file as a new one', () => {
    const merged = connect.mergeConfig('   ', URL, 'tok')

    expect('text' in merged && JSON.parse(merged.text).mcpServers['agents-studio'].headers)
      .toEqual({ Authorization: 'Bearer tok' })
  })
})

describe('what git says', () => {
  it('knows a tracked file from an untracked one', async () => {
    await writeFile(configPath(), '{}\n', 'utf8')
    expect(await connect.isTracked(repo, '.mcp.json')).toBe(false)

    git(repo, 'add', '.mcp.json')
    git(repo, 'commit', '-q', '-m', 'add')
    expect(await connect.isTracked(repo, '.mcp.json')).toBe(true)
  })

  it('treats a directory that is not a repository as untracked', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'agents-ui-mcp-plain-'))

    expect(await connect.isTracked(plain, '.mcp.json')).toBe(false)

    // And writing there works, with nothing to exclude.
    const result = await connect.connectProject(plain, URL)
    expect(result).toMatchObject({ ok: true, excluded: false })

    await rm(plain, { recursive: true, force: true })
  })
})
