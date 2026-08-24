import { describe, expect, it } from 'vitest'
import { cursorArgs, cursorConfig, cursorPrompt } from '../../server/utils/providers/cursor'
import type { ResolvedRunOptions } from '../../server/utils/runOptions'

const base: ResolvedRunOptions = {
  cwd: '/scratch/repo',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  loadSettings: true,
  plugins: [],
  systemAppend: '',
  agent: null,
  allowRules: [],
  additionalDirectories: [],
  sandbox: { enabled: true, allowedDomains: [] },
  unattended: false,
  effort: 'high',
  standingBrief: '',
}

/** The flag and its value, for asserting on a pair rather than on an index. */
function valueOf(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag)
  return at === -1 ? undefined : args[at + 1]
}

describe('the cursor-agent command line', () => {
  it('asks for a stream it can read incrementally', () => {
    const args = cursorArgs(base)

    expect(args).toContain('-p')
    expect(valueOf(args, '--output-format')).toBe('stream-json')
    // Without it Cursor sends each block once, whole, at the end of the turn.
    expect(args).toContain('--stream-partial-output')
  })

  /**
   * The first turn starts a conversation and every turn after it continues one.
   * Getting this wrong is invisible until somebody notices a session that has
   * forgotten everything it did — which is why it is asserted in both
   * directions rather than once.
   */
  it('does not resume on the first turn', () => {
    expect(cursorArgs(base)).not.toContain('--resume')
  })

  it('resumes with the chat id on every turn after it', () => {
    const args = cursorArgs(base, 'chat-57ab654c')
    expect(valueOf(args, '--resume')).toBe('chat-57ab654c')
  })

  it('treats an empty id as no id, rather than resuming nothing', () => {
    expect(cursorArgs(base, '')).not.toContain('--resume')
    expect(cursorArgs(base, null)).not.toContain('--resume')
  })

  /**
   * `--force` allows everything the deny list does not name. It is here for one
   * case only: a session deliberately set to Auto, which is the same session the
   * Claude path answers every prompt `allow` for. Anything else refuses rather
   * than widening its own policy to get moving.
   */
  it('never forces a run that was not set to skip its own prompts', () => {
    expect(cursorArgs(base)).not.toContain('--force')
    expect(cursorArgs({ ...base, permissionMode: 'plan' })).not.toContain('--force')
    expect(cursorArgs({ ...base, unattended: true })).not.toContain('--force')
  })

  it('forces only the session that was set to Auto', () => {
    expect(cursorArgs({ ...base, permissionMode: 'bypassPermissions' })).toContain('--force')
  })

  it('passes the model through, and leaves it out when nothing chose one', () => {
    expect(valueOf(cursorArgs({ ...base, model: 'composer-2.5' }), '--model')).toBe('composer-2.5')
    expect(cursorArgs(base)).not.toContain('--model')
  })

  it('adds each extra readable directory', () => {
    const args = cursorArgs({ ...base, additionalDirectories: ['/work/specs', '/work/docs'] })
    expect(args.filter(a => a === '--add-dir')).toHaveLength(2)
    expect(args).toContain('/work/specs')
    expect(args).toContain('/work/docs')
  })

  it('carries the sandbox either way, rather than leaving it to the config', () => {
    expect(valueOf(cursorArgs(base), '--sandbox')).toBe('enabled')
    expect(valueOf(cursorArgs({ ...base, sandbox: { enabled: false, allowedDomains: [] } }), '--sandbox'))
      .toBe('disabled')
  })

  it('trusts the workspace, because nothing headless can answer a trust prompt', () => {
    expect(cursorArgs(base)).toContain('--trust')
  })

  it('ignores the project config only when settings were turned off', () => {
    expect(cursorArgs(base)).not.toContain('--disable-project-configs')
    expect(cursorArgs({ ...base, loadSettings: false })).toContain('--disable-project-configs')
  })
})

/**
 * There is no flag for permissions: headless `cursor-agent` has no `canUseTool`
 * and reads its policy from `cli-config.json` at startup. The rules this app
 * already resolved are written into a config directory of the run's own, which
 * is the only one of the three available routes that touches neither the user's
 * own `~/.cursor` nor the repository.
 */
describe('the policy handed to a Cursor turn', () => {
  it('translates the app\'s allow rules into Cursor\'s own shape', () => {
    const config = cursorConfig({ ...base, allowRules: ['Bash(git status)', 'Read'] })

    expect(config.permissions).toEqual({ allow: ['Bash(git status)', 'Read'] })
    expect(config.approvalMode).toBe('allowlist')
  })

  /**
   * The rules go through `toSettingsPermissions`, the same function that builds
   * the Claude Code settings — so a rule granted once is granted to both agents
   * and there is no second list to keep in step.
   */
  it('merges and orders them the way the Claude path does, because it is the same function', () => {
    const config = cursorConfig({ ...base, allowRules: ['Read', 'Read', 'Bash(ls)'] })
    // Deduplicated and sorted by `mergeRules` — the order is its answer, not ours.
    expect((config.permissions as { allow: string[] }).allow).toEqual(['Bash(ls)', 'Read'])
  })

  /**
   * An empty list is the whole point. A run granted nothing can do nothing that
   * needs granting — it refuses, rather than being handed `--force` so it can
   * get moving.
   */
  it('grants nothing when nothing was granted', () => {
    expect(cursorConfig(base).permissions).toEqual({ allow: [], deny: [] })
  })
})

/**
 * `cursor-agent` has no `--append-system-prompt`, so an agent's instructions and
 * the standing brief have nowhere to go but the first thing the conversation
 * reads — which makes it a message rather than a system prompt. All of it on a
 * cold start, none of it on a resume.
 */
describe('the prompt for a Cursor turn', () => {
  it('prepends the system text on the first turn, since there is no flag for it', () => {
    const prompt = cursorPrompt({ ...base, systemAppend: 'You are a reviewer.' }, 'Look at the diff.')

    expect(prompt).toContain('You are a reviewer.')
    expect(prompt).toContain('Look at the diff.')
    expect(prompt.indexOf('You are a reviewer.')).toBeLessThan(prompt.indexOf('Look at the diff.'))
  })

  /**
   * All of it, not just the standing brief. `systemPromptFor(options, true)`
   * keeps the agent's instructions, which is right where the system prompt is a
   * channel of its own — here it would append them to the conversation again as
   * something the user apparently said, on every turn.
   */
  it('leaves the whole of it off a resumed turn, which has been told already', () => {
    const options = { ...base, systemAppend: 'You are a reviewer.', standingBrief: 'It is Tuesday.' }
    expect(cursorPrompt(options, 'And now the tests.', 'chat-1')).toBe('And now the tests.')
  })

  it('carries the standing brief on a cold start, where it is still worth having', () => {
    const prompt = cursorPrompt({ ...base, standingBrief: 'It is Tuesday.' }, 'Fix the build.')
    expect(prompt).toContain('It is Tuesday.')
  })

  it('sends the instruction alone when there is no system text', () => {
    expect(cursorPrompt(base, 'Fix the build.')).toBe('Fix the build.')
  })
})
