import { describe, expect, it } from 'vitest'
import { parseMcpList, parseMcpLine } from '../server/utils/mcp'

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
