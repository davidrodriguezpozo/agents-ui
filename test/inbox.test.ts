import { describe, it, expect } from 'vitest'
import {
  INBOX_DENIED_TOOLS, INBOX_SOURCES, findInboxSource, inboxItemId, parseInboxReply, visibleItems,
  type InboxSourceState,
} from '../server/utils/inbox'

const ok = (reply: string) => {
  const result = parseInboxReply(reply)
  if ('error' in result) throw new Error(`expected items, got: ${result.error}`)
  return result.items
}

const err = (reply: string) => {
  const result = parseInboxReply(reply)
  if (!('error' in result)) throw new Error('expected an error')
  return result.error
}

describe('reading what the model replied', () => {
  it('takes a bare array, which is what was asked for', () => {
    const items = ok('[{"title":"A ticket","url":"https://n/1","why":"Assigned to you."}]')
    expect(items).toEqual([
      { id: 'https://n/1', title: 'A ticket', url: 'https://n/1', why: 'Assigned to you.' },
    ])
  })

  it('takes a fenced or prefaced array, which is what often arrives', () => {
    const fenced = '```json\n[{"title":"T","url":"https://n/1","why":"w"}]\n```'
    expect(ok(fenced)).toHaveLength(1)

    const prefaced = 'Here is what I found:\n[{"title":"T","url":"https://n/1","why":"w"}]\nHope that helps!'
    expect(ok(prefaced)).toHaveLength(1)
  })

  it('accepts an empty list as a real answer', () => {
    expect(ok('[]')).toEqual([])
  })

  it('drops an entry with no url, because a row with nowhere to go is a dead end', () => {
    const items = ok('[{"title":"No link","why":"w"},{"title":"T","url":"https://n/1","why":"w"}]')
    expect(items.map(i => i.title)).toEqual(['T'])
  })

  it('drops an entry with no title', () => {
    expect(ok('[{"url":"https://n/1","why":"w"}]')).toEqual([])
  })

  it('fills in a reason rather than showing an empty line', () => {
    expect(ok('[{"title":"T","url":"https://n/1"}]')[0]!.why).toBe('Waiting on you.')
  })

  it('collapses the same page found twice by different queries', () => {
    const items = ok(`[
      {"title":"Found by search","url":"https://n/1?v=abc","why":"w"},
      {"title":"Found by query","url":"https://n/1","why":"w"}
    ]`)
    expect(items).toHaveLength(1)
  })

  it('explains itself when there is no list at all', () => {
    expect(err('I could not work out who you are.')).toContain('did not answer with a list')
    expect(err('I could not work out who you are.')).toContain('could not work out')
  })

  it('explains itself when the list will not parse', () => {
    expect(err('[{"title": broken}]')).toContain('not readable JSON')
  })

  it('treats an empty reply as a failure rather than as nothing to do', () => {
    // The difference matters: one means your inbox is clear, the other means
    // the refresh did not work.
    expect(err('')).toBe('It returned nothing.')
    expect(err('   ')).toBe('It returned nothing.')
  })

  it('is not fooled by a JSON object instead of a list', () => {
    expect(err('{"title":"T","url":"https://n/1"}')).toContain('did not answer with a list')
  })
})

describe('ids that survive a refresh', () => {
  it('ignores the query string and fragment, which change between queries', () => {
    expect(inboxItemId('https://notion.so/p/abc?v=123#block')).toBe('https://notion.so/p/abc')
  })

  it('ignores case and surrounding space', () => {
    expect(inboxItemId('  HTTPS://Notion.so/P/ABC  ')).toBe('https://notion.so/p/abc')
  })

  it('is stable when only the wording changes', () => {
    // The title gets edited and `why` is rewritten on every refresh; a
    // dismissal has to outlive both.
    const first = ok('[{"title":"Old name","url":"https://n/1","why":"one reason"}]')[0]!
    const later = ok('[{"title":"New name","url":"https://n/1","why":"another reason"}]')[0]!
    expect(later.id).toBe(first.id)
  })
})

describe('dismissals', () => {
  const state: InboxSourceState = {
    source: 'notion',
    items: [
      { id: 'a', title: 'A', url: 'a', why: 'w' },
      { id: 'b', title: 'B', url: 'b', why: 'w' },
    ],
    dismissed: ['a'],
  }

  it('hides what was waved away and keeps the rest', () => {
    expect(visibleItems(state).map(i => i.id)).toEqual(['b'])
  })

  it('is empty for a source that has never run', () => {
    expect(visibleItems(undefined)).toEqual([])
    expect(visibleItems({ source: 'notion', items: [] })).toEqual([])
  })
})

describe('the sources themselves', () => {
  it('names the MCP server each one needs, so a missing one can be explained', () => {
    for (const source of INBOX_SOURCES) {
      expect(source.requires, `${source.key} should name its server`).toBeTruthy()
      expect(source.tools.length, `${source.key} should allow-list its tools`).toBeGreaterThan(0)
    }
  })

  it('allow-lists only tools belonging to the server it needs', () => {
    // The spike, restricted with --allowedTools, grepped ~/.claude/plugins to
    // find a database id. Reasonable of it; not something an unattended refresh
    // should be able to do. Every tool here must be an MCP tool.
    for (const source of INBOX_SOURCES) {
      for (const tool of source.tools) {
        expect(tool.startsWith('mcp__'), `${tool} should be an MCP tool`).toBe(true)
      }
    }
  })

  it('tells each source to answer with a list and never to guess', () => {
    for (const source of INBOX_SOURCES) {
      expect(source.prompt).toContain('JSON array')
      expect(source.prompt).toContain('Never guess')
    }
  })

  it('can be looked up by key, and says so when there is no such source', () => {
    expect(findInboxSource('notion')?.label).toBe('Notion')
    expect(findInboxSource('nope')).toBeUndefined()
  })
})

describe('what a refresh may not touch', () => {
  /**
   * The deny-list is a measured result, not a preference. Both allow-list
   * approaches were tried against the real CLI:
   *
   *   --allowedTools <mcp only>  → it grepped ~/.claude/plugins for a database id
   *   --tools ""                 → asked to run `echo`, it ran `echo`
   *   --disallowedTools Bash     → refused
   *
   * So this list is the only thing standing between an unattended refresh and
   * the machine it runs on, and it is worth a test that says so.
   */
  it('forbids every way of reaching the filesystem or a shell', () => {
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'NotebookEdit']) {
      expect(INBOX_DENIED_TOOLS, `${tool} must be denied`).toContain(tool)
    }
  })

  it('forbids fetching the web directly, which is not what a source is for', () => {
    expect(INBOX_DENIED_TOOLS).toContain('WebFetch')
    expect(INBOX_DENIED_TOOLS).toContain('WebSearch')
  })

  it('forbids subagents, which are a way to get all of it back', () => {
    expect(INBOX_DENIED_TOOLS).toContain('Task')
  })

  it('does not deny the MCP tools the sources actually need', () => {
    for (const source of INBOX_SOURCES) {
      for (const tool of source.tools) {
        expect(INBOX_DENIED_TOOLS, `${tool} must stay available`).not.toContain(tool)
      }
    }
  })
})
