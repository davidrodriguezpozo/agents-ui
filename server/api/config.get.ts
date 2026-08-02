import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeDir } from '../utils/claudeDir'
import { getProjectDir } from '../utils/scope'

export default defineEventHandler((event) => {
  const claudeDir = getClaudeDir()
  const projectDir = getProjectDir(event)
  const projectClaudeDir = projectDir ? join(projectDir, '.claude') : null

  return {
    claudeDir,
    exists: existsSync(claudeDir),
    projectDir,
    projectClaudeDir,
    projectExists: projectClaudeDir ? existsSync(projectClaudeDir) : false,
  }
})
