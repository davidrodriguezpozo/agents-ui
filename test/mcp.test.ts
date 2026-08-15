import { describe, expect, it } from 'vitest'
import {
  addArgs, invalidName, parseMcpList, parseMcpLine, ptyCommand, ruleWontHelp, serverForTool,
} from '../server/utils/mcp'

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

/**
 * Whether granting a rule would do anything.
 *
 * The app's answer to a blocked run is "here is the narrow rule it needed", and
 * for an MCP tool that can be a lie. Measured on a real machine: `claude mcp
 * list` reported `claude.ai Gmail: ✔ Connected`, and a headless run allowed
 * exactly that server got no tools at all. A ritual there had been granted
 * eight rules over two mornings and was one blocked run from turning itself off.
 */
describe('serverForTool', () => {
  const servers = parseMcpList(REAL_OUTPUT)

  it('maps a connector tool back to the server it came from', () => {
    // Dots and spaces both become underscores in a tool name, so the match has
    // to go server → sanitised, never the other way.
    expect(serverForTool('mcp__claude_ai_Google_Calendar__list_events', servers)?.name)
      .toBe('claude.ai Google Calendar')
  })

  it('maps a plugin tool, whose name is full of colons', () => {
    expect(serverForTool('mcp__plugin_slack_slack__slack_read_channel', servers)?.name)
      .toBe('plugin:slack:slack')
  })

  it('is null for a tool that is not an MCP tool at all', () => {
    expect(serverForTool('Bash', servers)).toBeNull()
    expect(serverForTool('Bash(gh issue edit:*)', servers)).toBeNull()
  })

  it('is null for a server this machine does not have', () => {
    expect(serverForTool('mcp__notion__notion-search', servers)).toBeNull()
  })

  it('prefers the longer name when one sanitises into a prefix of another', () => {
    const both = parseMcpList([
      'acme: https://a.example/mcp - ✔ Connected',
      'acme_prod: https://b.example/mcp - ✔ Connected',
    ].join('\n'))

    expect(serverForTool('mcp__acme_prod__query', both)?.name).toBe('acme_prod')
  })
})

describe('ruleWontHelp', () => {
  const servers = parseMcpList(REAL_OUTPUT)

  it('says a connector cannot be granted, however connected it claims to be', () => {
    // Gmail is ✔ Connected in the fixture, which is the whole point.
    const reason = ruleWontHelp('mcp__claude_ai_Gmail__search', servers)
    expect(reason).toContain('claude.ai connector')
    expect(reason).toContain('no rule')
  })

  it('says a server needing a sign-in will not be fixed by a rule', () => {
    expect(ruleWontHelp('mcp__plugin_slack_slack__slack_read_channel', servers))
      .toContain('needs signing in')
  })

  it('names a broken server rather than offering a rule for it', () => {
    expect(ruleWontHelp('mcp__plugin_greptile_greptile__search', servers))
      .toContain('not answering')
  })

  it('has no objection to a rule for an ordinary tool', () => {
    expect(ruleWontHelp('Bash(gh issue edit:*)', servers)).toBeNull()
  })

  it('says a server that is simply gone is not there to grant', () => {
    // The case this was found by: rules granted for `claude.ai Slack` over two
    // mornings, and no such server on the machine by the time anyone looked.
    expect(ruleWontHelp('mcp__notion__notion-search', servers))
      .toContain('No MCP server matching notion')
  })

  it('yields no opinion at all when the server list could not be read', () => {
    // Empty means `claude mcp list` did not answer, never that nothing is
    // configured — inventing a verdict from that would blame the ritual for a
    // CLI that was busy.
    expect(ruleWontHelp('mcp__claude_ai_Gmail__search', [])).toBeNull()
  })
})
