import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { getClaudeDir } from '../../utils/claudeDir'
import { findClaude } from '../../utils/cli'

const exec = promisify(execFile)

/**
 * What this machine can actually do. The app works without the Claude Code CLI,
 * but installing team marketplaces needs git, so the UI surfaces that plainly
 * rather than failing at the moment someone clicks Install.
 */
export default defineEventHandler(async () => {
  const claudeCli = await findClaude()

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

  return {
    claudeDir,
    claudeDirExists: existsSync(claudeDir),
    git,
    gitVersion,
    claudeCli: Boolean(claudeCli),
    claudeCliPath: claudeCli,
    // Marketplaces are clone-based, so git is the one hard requirement.
    canInstallPlugins: git,
  }
})
