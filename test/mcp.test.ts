import { describe, expect, it } from 'vitest'
import { addArgs, invalidName, parseMcpList, parseMcpLine, ptyCommand } from '../server/utils/mcp'

/**
 * Reading `claude mcp list`.
 *
 * The fixture is real output from a machine with eight servers, kept verbatim
 * — including the failure whose detail is thirty words of HTML with dashes in
 * it, which is the line that breaks any parser that splits naively.
 */

const REAL_OUTPUT = `Checking MCP server health…

claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication
claude.ai Linear: https://mcp.linear.app/mcp - ✔ Connected
claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected
claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ! Needs authentication
claude.ai Google Drive: https://drivemcp.googleapis.com/mcp/v1 - ✔ Connected
plugin:slack:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication
plugin:greptile:greptile: https://api.greptile.com/mcp (HTTP) - ✘ Failed to connect — Server rejected the configured Authorization header (HTTP 403). Check that the token is valid for this MCP endpoint — OAuth fallback is disabled when headers.Authorization is set. Error detail: Streamable HTTP error: Error POSTing to endpoint: <html> <head><title>403 Forbidden</title></head> <body> <center><h1>403 Forbidden</h1></center> </body> </html>
plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication`

describe('parseMcpList', () => {
  const servers = parseMcpList(REAL_OUTPUT)

  it('finds every server and no noise', () => {
    // Eight servers; the header and the blank line are not servers.
    expect(servers).toHaveLength(8)
    expect(servers.some(s => s.name.includes('Checking'))).toBe(false)
  })

  it('keeps a name that contains colons intact', () => {
    // `plugin:slack:slack` would lose its tail to a split on the first colon.
    expect(servers.map(s => s.name)).toContain('plugin:slack:slack')
  })

  it('reads a name that contains spaces', () => {
    const drive = servers.find(s => s.name === 'claude.ai Google Drive')
    expect(drive?.target).toBe('https://drivemcp.googleapis.com/mcp/v1')
  })

  it('separates transport from the target', () => {
    const slack = servers.find(s => s.name === 'plugin:slack:slack')
    expect(slack?.transport).toBe('HTTP')
    expect(slack?.target).toBe('https://mcp.slack.com/mcp')
  })

  it('leaves transport unset for an unlabelled server', () => {
    expect(servers.find(s => s.name === 'claude.ai Linear')?.transport).toBeUndefined()
  })

  it('tells working, unauthenticated and broken apart', () => {
    expect(servers.find(s => s.name === 'claude.ai Linear')?.status).toBe('connected')
    expect(servers.find(s => s.name === 'claude.ai Notion')?.status).toBe('needs-auth')
    expect(servers.find(s => s.name === 'plugin:greptile:greptile')?.status).toBe('failed')
  })

  it('survives a failure detail full of dashes and HTML', () => {
    const broken = servers.find(s => s.name === 'plugin:greptile:greptile')
    // The em-dashes and ` - ` inside the message must not steal the split.
    expect(broken?.target).toBe('https://api.greptile.com/mcp')
    expect(broken?.transport).toBe('HTTP')
    expect(broken?.detail).toContain('403')
  })

  it('says nothing extra about a server that works', () => {
    // "Connected" beside a tick is the same word twice.
    expect(servers.find(s => s.name === 'claude.ai Linear')?.detail).toBeUndefined()
  })

  it('works out where each one came from', () => {
    expect(servers.find(s => s.name === 'plugin:figma:figma')).toMatchObject({
      origin: 'plugin', pluginName: 'figma',
    })
    expect(servers.find(s => s.name === 'claude.ai Gmail')?.origin).toBe('claude.ai')
  })
})

describe('parseMcpLine', () => {
  it('reads a stdio server, which has a command instead of a URL', () => {
    expect(parseMcpLine('my-server: npx -y @acme/mcp --flag - ✔ Connected')).toMatchObject({
      name: 'my-server',
      target: 'npx -y @acme/mcp --flag',
      status: 'connected',
      origin: 'project',
    })
  })

  it('reads a server awaiting approval', () => {
    expect(parseMcpLine('local-thing: ./server.js - ⏸ Pending approval')?.status).toBe('pending')
  })

  it('ignores anything that is not a server line', () => {
    expect(parseMcpLine('Checking MCP server health…')).toBeNull()
    expect(parseMcpLine('')).toBeNull()
    expect(parseMcpLine('   ')).toBeNull()
    expect(parseMcpLine('No MCP servers configured.')).toBeNull()
  })

  it('does not invent a server from a line with no status marker', () => {
    expect(parseMcpLine('something: else - and more')).toBeNull()
  })
})

describe('addArgs', () => {
  const base = { name: 'acme', scope: 'local' as const }

  it('builds an http server', () => {
    expect(addArgs({ ...base, transport: 'http', target: 'https://mcp.acme.dev/mcp' }))
      .toEqual(['mcp', 'add', '--scope', 'local', '--transport', 'http', 'acme', 'https://mcp.acme.dev/mcp'])
  })

  it('leaves transport off for stdio, which is the default', () => {
    expect(addArgs({ ...base, transport: 'stdio', target: 'my-server' }))
      .toEqual(['mcp', 'add', '--scope', 'local', 'acme', '--', 'my-server'])
  })

  it('puts the command behind `--` so its own flags survive', () => {
    // Without the separator, `--verbose` is read as a flag to `claude mcp add`.
    expect(addArgs({ ...base, transport: 'stdio', target: 'npx', args: ['-y', 'srv', '--verbose'] }))
      .toEqual(['mcp', 'add', '--scope', 'local', 'acme', '--', 'npx', '-y', 'srv', '--verbose'])
  })

  it('keeps an argument containing a space in one piece', () => {
    const args = addArgs({ ...base, transport: 'stdio', target: '/opt/my server/run', args: ['--dir', '/a b/c'] })
    expect(args).toContain('/opt/my server/run')
    expect(args).toContain('/a b/c')
  })

  it('passes env and headers in the shape the CLI wants', () => {
    expect(addArgs({ ...base, transport: 'stdio', target: 'srv', env: { API_KEY: 'x' } }))
      .toContain('API_KEY=x')
    expect(addArgs({ ...base, transport: 'http', target: 'https://a.dev', headers: { Authorization: 'Bearer x' } }))
      .toContain('Authorization: Bearer x')
  })

  it('writes the scope it was given', () => {
    expect(addArgs({ ...base, scope: 'project', transport: 'http', target: 'https://a.dev' }))
      .toEqual(expect.arrayContaining(['--scope', 'project']))
  })
})

describe('invalidName', () => {
  it('accepts what Claude Code and a URL can both carry', () => {
    expect(invalidName('acme')).toBeNull()
    expect(invalidName('acme-tools_v2.1')).toBeNull()
  })

  it('refuses a name nothing could address afterwards', () => {
    expect(invalidName('')).not.toBeNull()
    expect(invalidName('   ')).not.toBeNull()
    expect(invalidName('my server')).not.toBeNull()
    expect(invalidName('a/b')).not.toBeNull()
    expect(invalidName('x'.repeat(65))).not.toBeNull()
  })
})

describe('ptyCommand', () => {
  const CLAUDE = '/usr/local/bin/claude'

  it('passes every part as its own argument under python', () => {
    // `claude mcp login` refuses outright without a terminal, which is why the
    // wrapper exists at all. Separate argv entries mean nothing needs quoting.
    const { file, args } = ptyCommand('python', CLAUDE, ['mcp', 'login', 'claude.ai Google Drive'])
    expect(file).toBe('python3')
    expect(args.slice(-4)).toEqual([CLAUDE, 'mcp', 'login', 'claude.ai Google Drive'])
    expect(args[0]).toBe('-c')
    expect(args[1]).toContain('pty.spawn')
  })

  it('keeps a name with spaces and colons in one piece under script', () => {
    // Real names look like `plugin:slack:slack` and `claude.ai Google Drive`.
    const { args } = ptyCommand('script', CLAUDE, ['mcp', 'login', 'plugin:slack:slack'])

    if (process.platform === 'darwin') {
      expect(args).toEqual(['-q', '/dev/null', CLAUDE, 'mcp', 'login', 'plugin:slack:slack'])
    } else {
      const line = args[args.indexOf('-c') + 1]!
      expect(line).toContain(`'plugin:slack:slack'`)
    }
  })

  it('escapes a quote rather than letting it end the string', () => {
    if (process.platform === 'darwin') return
    const { args } = ptyCommand('script', CLAUDE, ['mcp', 'login', "od'd"])
    expect(args[args.indexOf('-c') + 1]).toContain(`'od'\\''d'`)
  })
})
