import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/*
 * Nitro auto-imports, which these tests run outside of. The endpoint needs more
 * of them than a util does, because it is the half that touches HTTP — and it is
 * the half where the loopback refusal actually happens, so it is worth covering
 * rather than assuming.
 */
;(globalThis as any).createError = (init: any) => Object.assign(new Error(init.message), init)
;(globalThis as any).defineEventHandler = (fn: any) => fn
;(globalThis as any).getHeader = (event: any, name: string) => event.headers?.[name]
;(globalThis as any).readRawBody = async (event: any) => event.body
;(globalThis as any).setResponseStatus = (event: any, code: number) => { event.status = code }

/**
 * The app as a tool server.
 *
 * Three things here can be wrong in a way nothing else would notice. The two
 * gates — a token read off disk, and a peer address on loopback — are the only
 * thing between one line of JSON and a session started on somebody's repository,
 * and a gate that fails open fails silently. The tool shapes are the other half:
 * a client reads these once at handshake, so a field quietly renamed does not
 * break here, it breaks in whatever a session concluded from the answer.
 */

let dir: string
let access: typeof import('../server/utils/mcpAccess')
let server: typeof import('../server/utils/mcpServer')
let attention: typeof import('../server/utils/attention')
let sessions: typeof import('../server/utils/sessions')
let brief: typeof import('../server/utils/brief')
let endpoint: (event: any) => Promise<any>

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agents-ui-mcp-'))
  process.env.CLAUDE_DIR = dir

  access = await import('../server/utils/mcpAccess')
  server = await import('../server/utils/mcpServer')
  attention = await import('../server/utils/attention')
  sessions = await import('../server/utils/sessions')
  brief = await import('../server/utils/brief')
  endpoint = (await import('../server/api/mcp/rpc.post')).default as any
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_DIR
})

beforeEach(async () => {
  await rm(join(dir, 'agents-ui'), { recursive: true, force: true })
  access.forgetMcpToken()
})

/** The JSON a tool returns, parsed, because that is what a caller reads. */
async function toolJson(name: string, args: Record<string, unknown> = {}) {
  const result = await server.callTool(name, args)
  expect(result.isError).toBeFalsy()
  return JSON.parse(result.content[0]!.text)
}

function stub(id: string, patch: Partial<import('../server/utils/sessions').Session> = {}) {
  return {
    id,
    title: `Session ${id}`,
    repoDir: '/repos/thing',
    worktreePath: `/repos/thing/.worktrees/${id}`,
    branch: `agents-ui/${id}`,
    baseBranch: 'main',
    baseSha: 'abc1234',
    status: 'idle' as const,
    runIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

describe('the loopback check', () => {
  it('accepts this machine talking to itself, however it spells it', () => {
    expect(access.isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(access.isLoopbackAddress('::1')).toBe(true)
    expect(access.isLoopbackAddress('0:0:0:0:0:0:0:1')).toBe(true)
    // What a v4 client looks like to a socket listening on v6, which is the
    // normal case on a dual-stack machine rather than an edge one.
    expect(access.isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    // The kernel's loopback is the whole of 127/8, not one address in it.
    expect(access.isLoopbackAddress('127.0.0.53')).toBe(true)
    expect(access.isLoopbackAddress('[::1]')).toBe(true)
  })

  it('refuses everything else, including an address it could not read', () => {
    expect(access.isLoopbackAddress('192.168.1.5')).toBe(false)
    expect(access.isLoopbackAddress('10.0.0.42')).toBe(false)
    expect(access.isLoopbackAddress('128.0.0.1')).toBe(false)
    // Not evidence of loopback. The failure to prefer is nothing getting in.
    expect(access.isLoopbackAddress(undefined)).toBe(false)
    expect(access.isLoopbackAddress('')).toBe(false)
  })

  it('is not fooled by an address-shaped name', () => {
    expect(access.isLoopbackAddress('127.0.0.1.evil.example')).toBe(false)
    expect(access.isLoopbackAddress('127.999.0.1')).toBe(false)
    expect(access.isLoopbackAddress('localhost')).toBe(false)
  })

  it('refuses a LAN peer before it looks at the token at all', () => {
    // HOST=0.0.0.0 invites the phone in for the rest of the app. Not for the
    // one route that starts sessions.
    const verdict = access.checkMcpAccess(
      { address: '192.168.1.5', authorization: 'Bearer right' },
      'right',
    )

    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.status).toBe(403)
    expect(verdict.allowed === false && verdict.message).toContain('loopback')
  })
})

describe('the token check', () => {
  it('lets the right token through', () => {
    expect(access.checkMcpAccess({ address: '127.0.0.1', authorization: 'Bearer right' }, 'right'))
      .toEqual({ allowed: true })
  })

  it('reads the scheme case-insensitively, as HTTP requires', () => {
    expect(access.bearerToken('bearer right')).toBe('right')
    expect(access.bearerToken('Bearer   right  ')).toBe('right')
    expect(access.bearerToken('Basic right')).toBeNull()
    expect(access.bearerToken(undefined)).toBeNull()
  })

  it('accepts the plain header for a client that cannot set Authorization', () => {
    expect(access.checkMcpAccess({ address: '::1', token: 'right' }, 'right'))
      .toEqual({ allowed: true })
  })

  it('refuses a wrong token, and says where the real one is', () => {
    const verdict = access.checkMcpAccess(
      { address: '127.0.0.1', authorization: 'Bearer wrong' },
      'right',
    )

    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.status).toBe(401)
    expect(verdict.allowed === false && verdict.message).toContain('mcp-token')
  })

  it('refuses no token at all', () => {
    const verdict = access.checkMcpAccess({ address: '127.0.0.1' }, 'right')
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.error).toBe('no_token')
  })

  it('never matches an empty presented token, whatever is expected', () => {
    // The case that matters: a half-written token file read back as ''. If that
    // matched, every caller would be authorised by sending nothing.
    expect(access.tokensMatch('', '')).toBe(true)
    expect(access.checkMcpAccess({ address: '127.0.0.1', token: '' }, '').allowed).toBe(false)
  })

  it('does not match tokens of different lengths', () => {
    expect(access.tokensMatch('short', 'longer-token')).toBe(false)
  })
})

describe('the token on disk', () => {
  it('creates one nobody can read but you', async () => {
    const token = await access.readMcpToken()

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const mode = (await stat(access.mcpTokenPath())).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('hands back the same one next time, so a config does not go stale', async () => {
    const first = await access.readMcpToken()
    access.forgetMcpToken()
    expect(await access.readMcpToken()).toBe(first)
  })

  it('replaces a half-written empty file rather than trusting it', async () => {
    // An empty file is an interrupted write, not a token. Accepting '' would
    // authorise anyone who sends nothing.
    await access.readMcpToken()
    await writeFile(access.mcpTokenPath(), '\n', 'utf-8')
    access.forgetMcpToken()

    expect(await access.readMcpToken()).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the wire protocol', () => {
  it('answers a handshake with tools and nothing else', async () => {
    const response = await server.handleRpc({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' },
    })

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'agents-studio' },
      },
    })
    // Declaring a capability we do not have means a client asks and is refused.
    expect((response as any).result.capabilities).toEqual({ tools: {} })
  })

  it('names a version it can speak when the client asks for one it cannot', async () => {
    const response = await server.handleRpc({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' },
    })

    expect((response as any).result.protocolVersion).toBe(server.PROTOCOL_VERSION)
  })

  it('lists the four reads and the one write, each with a schema', async () => {
    const response = await server.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (response as any).result.tools

    expect(tools.map((t: any) => t.name))
      .toEqual(['brief', 'blocked', 'sessions', 'spend_today', 'start_session'])

    for (const tool of tools) {
      expect(tool.title).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema.type).toBe('object')
      // No handler leaks into the listing — it would not survive JSON anyway,
      // and a tool definition with a function in it is a bug worth catching.
      expect(Object.keys(tool).sort()).toEqual(['description', 'inputSchema', 'name', 'title'])
    }

    const write = tools.find((t: any) => t.name === 'start_session')
    expect(write.inputSchema.required).toEqual(['repo', 'instruction'])
  })

  it('says nothing back to a notification', async () => {
    // Answering one is a protocol error of our own, and `initialized` is sent
    // by every client on every connection.
    await expect(server.handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }))
      .resolves.toBeNull()
  })

  it('answers a ping, so a client can tell the app is still there', async () => {
    await expect(server.handleRpc({ jsonrpc: '2.0', id: 3, method: 'ping' }))
      .resolves.toEqual({ jsonrpc: '2.0', id: 3, result: {} })
  })

  it('refuses a method it does not implement, naming the ones it does', async () => {
    const response = await server.handleRpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' })

    expect((response as any).error.code).toBe(server.RPC_METHOD_NOT_FOUND)
    expect((response as any).error.message).toContain('tools/list')
  })

  it('refuses a batch rather than answering half of one', async () => {
    const response = await server.handleRpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
    expect((response as any).error.code).toBe(server.RPC_INVALID_REQUEST)
  })

  it('refuses a tools/call with no tool named', async () => {
    const response = await server.handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} })
    expect((response as any).error.code).toBe(server.RPC_INVALID_PARAMS)
  })

  it('reports an unknown tool to the model, not to the transport', async () => {
    // A session that is told the tool does not exist can pick another one. A
    // transport error only tells it the server broke.
    const response = await server.handleRpc({
      jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'close_session' },
    })

    expect((response as any).error).toBeUndefined()
    expect((response as any).result.isError).toBe(true)
    expect((response as any).result.content[0].text).toContain('start_session')
  })
})

describe('brief', () => {
  it('says the brief is empty rather than returning nothing', async () => {
    const result = await server.callTool('brief', {})
    expect(result.content[0]!.text).toContain('empty')
  })

  it('says so when it is switched off, which is a different fact', async () => {
    await brief.briefStore.write({ enabled: false, pinned: 'Ana is out until September.', facts: brief.EMPTY_FACTS })

    const result = await server.callTool('brief', {})
    expect(result.content[0]!.text).toContain('turned off')
  })

  it('returns the exact text a run receives', async () => {
    await brief.briefStore.write({
      enabled: true,
      pinned: 'The release goes out on Thursdays.',
      facts: { ...brief.EMPTY_FACTS },
    })

    const result = await server.callTool('brief', {})
    const stored = await brief.readBrief()

    expect(result.content[0]!.text).toBe(brief.renderBrief(stored))
    expect(result.content[0]!.text).toContain('The release goes out on Thursdays.')
  })
})

describe('blocked', () => {
  it('gives the same answer the sidebar does', async () => {
    // Two derivations of "what is blocked" would disagree within a week, and a
    // run told nothing is waiting stops looking.
    await sessions.saveSession(stub('a', { runIds: ['run-a'] }))

    expect(await toolJson('blocked')).toEqual(await attention.collectAttention())
  })

  it('reports the counts alongside the items, so neither has to be derived', async () => {
    const answer = await toolJson('blocked')

    expect(Object.keys(answer).sort())
      .toEqual(['blocked', 'failingRituals', 'items', 'needsYou', 'working'])
    expect(answer.needsYou).toBe(answer.items.length)
  })
})

describe('sessions', () => {
  it('reports what the brief asked for, plus the path start_session needs', async () => {
    await sessions.saveSession(stub('a', {
      updatedAt: 10,
      check: { status: 'failing', at: 5, command: 'make check', exitCode: 1 } as any,
      summary: { text: 'Upload now rejects files over 5MB.', at: 5, costUsd: 0.004 } as any,
    }))

    const [one] = (await toolJson('sessions')).sessions

    expect(one).toMatchObject({
      id: 'a',
      repo: 'thing',
      repoDir: '/repos/thing',
      branch: 'agents-ui/a',
      checks: 'failing',
      summary: 'Upload now rejects files over 5MB.',
      running: false,
    })
  })

  it('says no verdict rather than passing when the checks never ran', async () => {
    await sessions.saveSession(stub('a'))
    expect((await toolJson('sessions')).sessions[0].checks).toBeNull()
  })

  it('leaves out closed sessions and puts the newest first', async () => {
    // Written straight to the store rather than saved one at a time: saveSession
    // stamps updatedAt itself, and three saves inside the same millisecond have
    // no order to test.
    await sessions.writeSessions([
      stub('old', { updatedAt: 1 }),
      stub('new', { updatedAt: 99 }),
      stub('closed', { updatedAt: 50, status: 'archived' }),
    ])

    expect((await toolJson('sessions')).sessions.map((s: any) => s.id)).toEqual(['new', 'old'])
  })

  it('says how many it left out rather than truncating quietly', async () => {
    const ids = Array.from({ length: server.MAX_MCP_SESSIONS + 2 }, (_, i) => `s${i}`)
    await sessions.writeSessions(ids.map((id, i) => stub(id, { updatedAt: i })))

    const answer = await toolJson('sessions')
    expect(answer.sessions).toHaveLength(server.MAX_MCP_SESSIONS)
    expect(answer.more).toBe(2)
  })
})

describe('spend_today', () => {
  it('reports nothing spent on a machine that has done nothing', async () => {
    const answer = await toolJson('spend_today')

    expect(answer).toMatchObject({ spentUsd: 0, runs: 0, dailyCapUsd: null, overCap: false })
    expect(answer.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('counts the summaries that never enter the run log', async () => {
    // Leaving them out would make this quietly optimistic, which is the one
    // thing a spend figure must not be.
    await sessions.saveSession(stub('a', {
      summary: { text: 'Did a thing.', at: Date.now(), costUsd: 0.0075 } as any,
    }))

    const answer = await toolJson('spend_today')
    expect(answer.spentUsd).toBe(0.0075)
    expect(answer.bySource).toEqual([{ source: 'summary', costUsd: 0.0075, runs: 1 }])
  })
})

describe('start_session', () => {
  it('asks for a repository rather than guessing one', async () => {
    const result = await server.callTool('start_session', { instruction: 'fix the flaky test' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('repo')
  })

  it('refuses to cut a worktree for nothing to do', async () => {
    const result = await server.callTool('start_session', { repo: dir, instruction: '   ' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('instruction')
  })

  it('names the path it could not find', async () => {
    const missing = join(dir, 'no-such-repo')
    const result = await server.callTool('start_session', { repo: missing, instruction: 'go' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain(missing)
  })

  it('refuses a relative path instead of resolving it against nowhere', async () => {
    // A background service's working directory is nobody's idea of anywhere.
    expect(server.resolveRepoPath('../thing')).toBeNull()
    expect(server.resolveRepoPath('')).toBeNull()

    const result = await server.callTool('start_session', { repo: './thing', instruction: 'go' })
    expect(result.isError).toBe(true)
  })

  it('expands ~ , because an agent will write it', () => {
    expect(server.resolveRepoPath('~')).toBe(process.env.HOME)
  })

  it('reports a directory that is not a repository as the sentence it is', async () => {
    // Goes through the real startSession, so this is also the proof that the
    // tool is not a second way of making a session.
    const result = await server.callTool('start_session', { repo: dir, instruction: 'go' })

    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('not a git repository')
  })
})

describe('the endpoint', () => {
  /** A request as h3 hands it over, minus everything this route does not read. */
  function request(opts: { address?: string; headers?: Record<string, string>; body?: string }) {
    return {
      node: { req: { socket: { remoteAddress: opts.address } } },
      headers: opts.headers ?? {},
      body: opts.body ?? '',
      status: 200,
    }
  }

  it('refuses a request that did not arrive on loopback, and says so', async () => {
    const token = await access.readMcpToken()
    const event = request({
      address: '192.168.1.5',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })

    await expect(endpoint(event)).rejects.toMatchObject({
      statusCode: 403,
      data: { error: 'not_loopback' },
    })
  })

  it('refuses the wrong token even from this machine', async () => {
    await access.readMcpToken()
    const event = request({
      address: '127.0.0.1',
      headers: { authorization: 'Bearer nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })

    await expect(endpoint(event)).rejects.toMatchObject({
      statusCode: 401,
      data: { error: 'bad_token' },
    })
  })

  it('answers a properly authorised call', async () => {
    const token = await access.readMcpToken()
    const event = request({
      address: '::ffff:127.0.0.1',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
    })

    const response = await endpoint(event)
    expect(response.result.tools).toHaveLength(5)
  })

  it('returns a JSON-RPC parse error rather than h3\'s 400', async () => {
    const token = await access.readMcpToken()
    const event = request({
      address: '127.0.0.1',
      headers: { authorization: `Bearer ${token}` },
      body: '{ not json',
    })

    expect((await endpoint(event)).error.code).toBe(-32700)
  })

  it('answers a notification with 202 and no body', async () => {
    const token = await access.readMcpToken()
    const event = request({
      address: '127.0.0.1',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    expect(await endpoint(event)).toBeNull()
    expect(event.status).toBe(202)
  })
})
