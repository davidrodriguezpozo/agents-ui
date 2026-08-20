import { Box, Text, useInput } from 'ink'
import { shortenHome } from '../../format'
import type { Project } from '../../types'
import { EmptyState } from '../components'
import { useStudio } from '../context'
import { ACCENT } from '../theme'

/**
 * A project, and the two different things "switch to it" can mean.
 *
 * `⏎` points this window at it. `S` also writes it as the app's default, which
 * the browser and the service read. Cycling with `[`/`]` used to do the second
 * thing, which is a surprising amount of blast radius for a key you press while
 * looking around.
 */
export function ProjectPane({
  project,
  focused,
  width,
}: {
  project: Project | undefined
  focused: boolean
  width: number
}) {
  const { keys, projects, scope, setScope, makeDefault, openBrowser } = useStudio()
  const home = projects?.home ?? ''

  useInput((input, key) => {
    if (!project) return
    if (keys.matches('project.focus', input, key)) setScope(project.path)
    if (keys.matches('project.default', input, key)) void makeDefault(project.path)
    if (keys.matches('browser', input, key)) openBrowser('/')
  }, { isActive: focused })

  if (!project) return <EmptyState>That project is gone.</EmptyState>

  const here = project.path === scope
  const isDefault = project.path === projects?.activePath

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text wrap="truncate">
        <Text color={ACCENT} bold>{project.name || shortenHome(project.path, home)}</Text>
      </Text>
      <Box paddingTop={1} flexDirection="column" flexGrow={1} overflow="hidden">
        {[
          shortenHome(project.path, home),
          project.branch ? `on ${project.branch}` : 'not a git repo',
          `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`,
          project.hasClaudeDir ? 'has a .claude directory' : 'no .claude directory',
          project.exists ? '' : 'this path is missing on disk',
          '',
          here ? 'this window is looking here' : '⏎ to look here',
          isDefault ? 'the app default' : 'S to make it the app default too',
        ].filter(line => line !== '').map((line, i) => (
          <Text key={i} color="gray" wrap="truncate">{line.slice(0, width)}</Text>
        ))}
      </Box>
      <Box paddingTop={1} flexShrink={0}>
        <Text color="gray" wrap="truncate">
          {keys.hint(['project.focus', 'project.default', 'browser'])}
        </Text>
      </Box>
    </Box>
  )
}
