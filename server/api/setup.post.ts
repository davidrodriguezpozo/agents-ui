import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getClaudeDir, resolveClaudePath } from '../utils/claudeDir'

/**
 * Make the directories a new set-up needs.
 *
 * It used to refuse the moment `~/.claude` existed, and on a cold machine that
 * was always — this app writes its own storage into `~/.claude/agents-ui` while
 * booting, which creates the parent before anybody sees the page.
 *
 * The consequence was a loop rather than an error, which is why it survived so
 * long. The welcome asked to set things up, this returned "Directory already
 * exists" without creating anything, the toast said it had worked, and the next
 * read found nothing configured and showed the welcome again.
 *
 * So it asks per directory instead of about the parent. Creating what is
 * missing and leaving what is there is both idempotent and the only behaviour
 * that is correct when the parent is half-made — which is the normal case here,
 * not an edge one.
 */
export default defineEventHandler(async () => {
  const claudeDir = getClaudeDir()

  const wanted = [
    claudeDir,
    resolveClaudePath('agents'),
    resolveClaudePath('commands'),
    resolveClaudePath('skills'),
  ]

  // Recorded before anything is made, so the answer describes what this call
  // did rather than what the filesystem looks like afterwards.
  const missing = wanted.filter(dir => !existsSync(dir))

  for (const dir of wanted) {
    await mkdir(dir, { recursive: true })
  }

  return {
    created: missing.length > 0,
    createdPaths: missing,
    claudeDir,
  }
})
