import { describe, expect, it } from 'vitest'
import { refreshNotionIntake } from '../server/utils/notionIntakeRefresh'

/**
 * The two refusals that happen before anything is spent.
 *
 * Worth pinning down because they are the common case rather than the edge one: a
 * machine whose tickets are not in Notion, and a window with no project picked
 * yet. Both used to be the kind of thing that gets discovered by a run costing
 * cents and reporting that it could not find a database — which is the wrong way
 * round, and the reason `pickInboxServer` exists at all.
 *
 * Neither of these reaches the store, the MCP probe or the CLI, so this test
 * spends nothing and needs nothing stubbed. The refusal after them — the server
 * not being connected — is `pickInboxServer`'s, tested in `inbox.test.ts`, and
 * what the band does with it is in `issues.test.ts`.
 */
describe('reading Notion, refused before it costs anything', () => {
  it('refuses when no data source or status value has been chosen', async () => {
    const result = await refreshNotionIntake(
      { dataSource: '', statusProperty: 'Status', statusValue: '' },
      '/tmp/some-project',
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.refusal.error).toBe('not_configured')
    expect(!result.ok && result.refusal.message).toContain('Settings')
  })

  it('refuses half a configuration, rather than asking half a question', async () => {
    const result = await refreshNotionIntake(
      { dataSource: 'collection://abc', statusProperty: 'Status', statusValue: '  ' },
      '/tmp/some-project',
    )

    expect(!result.ok && result.refusal.error).toBe('not_configured')
  })

  it('refuses with no project, because that is what decides which tools answer', async () => {
    // MCP reachability depends on the directory the question is asked from:
    // Notion answers from one of this machine's projects and is not configured in
    // another. There is nowhere to ask from until a project is picked.
    const result = await refreshNotionIntake(
      { dataSource: 'collection://abc', statusProperty: 'Status', statusValue: 'Ready' },
      undefined,
    )

    expect(!result.ok && result.refusal.error).toBe('no_project')
    expect(!result.ok && result.refusal.message).toContain('Pick a project first')
  })
})
