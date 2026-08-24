import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { getClaudeDir } from '../../utils/claudeDir'
import { findClaude } from '../../utils/cli'
import { findCursorAgent } from '../../utils/cursorAgentExecutable'
import { PROVIDER_IDS, providerFor } from '../../utils/providers'

const exec = promisify(execFile)

/**
 * What this machine can actually do. The app works without the Claude Code CLI,
 * but installing team marketplaces needs git, so the UI surfaces that plainly
 * rather than failing at the moment someone clicks Install.
 *
 * The same reasoning is why the providers are here. A session picker offering
 * Cursor on a machine with no `cursor-agent` is a choice that fails on the first
 * turn, after the worktree has been cut — so which agents are installed is
 * answered before anybody picks one, from the same lookups the runs use.
 */
export default defineEventHandler(async () => {
  const claudeCli = await findClaude()
  const cursorCli = findCursorAgent()

  let git = false
  let gitVersion = ''
  try {
    const { stdout } = await exec('git', ['--version'], { timeout: 5_000 })
    git = true
    gitVersion = stdout.trim()
  } catch {
    git = false
  }

  const claudeDir = getClaudeDir()

  /** Where each provider's binary is, or null when it is not installed. */
  const installed: Record<string, string | null> = {
    claude: claudeCli,
    cursor: cursorCli,
  }

  return {
    claudeDir,
    claudeDirExists: existsSync(claudeDir),
    git,
    gitVersion,
    claudeCli: Boolean(claudeCli),
    claudeCliPath: claudeCli,
    // Marketplaces are clone-based, so git is the one hard requirement.
    canInstallPlugins: git,
    /**
     * Every provider this build knows, whether this machine has it, and what it
     * can do. The capabilities travel with it because the page that picks a
     * provider is also the page that has to say a Cursor session cannot be
     * asked for permission mid-turn — one request, not two.
     */
    providers: PROVIDER_IDS.map((id) => {
      const provider = providerFor(id)
      return {
        id,
        label: provider.label,
        available: Boolean(installed[id]),
        path: installed[id] ?? null,
        capabilities: provider.capabilities,
      }
    }),
  }
})
