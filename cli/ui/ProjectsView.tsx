import { Box, useInput } from 'ink'
import { useState } from 'react'
import { matchesFilter, shortenHome, windowAround, type Tone } from '../format'
import type { Project } from '../types'
import {
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
} from './components'
import { useStudio } from './context'
import { useSelection, useTerminalSize } from './hooks'
import { isWide, listCapacity, listLayout } from './theme'

export function ProjectsView({ isActive }: { isActive: boolean }) {
  const { projects, setActiveProject, mode, setMode, openBrowser } = useStudio()
  const { columns, rows: termRows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const [filter, setFilter] = useState('')
  const home = projects?.home ?? ''
  const list = (projects?.projects ?? []).filter(p => matchesFilter(`${p.name ?? ''} ${p.path}`, filter))
  const [index] = useSelection(list.length, isActive && mode === 'nav')
  const selected = list[index]
  const chrome = wide ? 10 : 13
  const shown = windowAround(list, index, listCapacity(termRows, chrome, 2))
  const listWidth = wide ? Math.floor(columns * 0.52) : layout.inner
  const inspectorWidth = wide ? Math.max(24, columns - listWidth - 8) : layout.inner

  useInput((input, key) => {
    if (input === '/') setMode('filter')
    if (key.return && selected) void setActiveProject(selected.path)
    if (input === 'x') void setActiveProject(null)
    if (input === 'o') openBrowser('/')
  }, { isActive: isActive && mode === 'nav' })

  const rows = (
    <Box flexDirection="column" flexGrow={1}>
      {list.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'No projects. Press o to add one in the browser.'}</EmptyState>
      ) : (
        shown.map(project => (
          <ProjectRow
            key={project.path}
            project={project}
            home={home}
            active={project.path === projects?.activePath}
            selected={project.path === selected?.path}
            width={listWidth}
          />
        ))
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Split
        wide={wide}
        listWidth={listWidth}
        list={rows}
        inspector={
          selected ? (
            <ProjectInspector
              project={selected}
              home={home}
              active={selected.path === projects?.activePath}
              width={inspectorWidth}
            />
          ) : (
            <Inspector
              title="Projects"
              lines={[projects?.activePath ? shortenHome(projects.activePath, home) : 'None selected.']}
              hint="⏎ switch   ] next   [ previous   x clear"
              width={inspectorWidth}
            />
          )
        }
      />
      {mode === 'filter' && isActive ? (
        <FilterBar
          value={filter}
          onChange={setFilter}
          onClose={clear => {
            if (clear) setFilter('')
            setMode('nav')
          }}
          isActive
        />
      ) : null}
    </Box>
  )
}

function ProjectRow({
  project,
  home,
  active,
  selected,
  width,
}: {
  project: Project
  home: string
  active: boolean
  selected: boolean
  width: number
}) {
  const tone: Tone = !project.exists ? 'red' : active ? 'cyan' : 'gray'
  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} />}
      status={active ? 'Active' : project.exists ? 'Saved' : 'Missing'}
      statusTone={tone}
      title={project.name || shortenHome(project.path, home)}
      trailing={project.branch || '—'}
      detail={`${shortenHome(project.path, home)} · ${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`}
      width={width}
    />
  )
}

function ProjectInspector({
  project,
  home,
  active,
  width,
}: {
  project: Project
  home: string
  active: boolean
  width: number
}) {
  return (
    <Inspector
      title={project.name || shortenHome(project.path, home)}
      lines={[
        shortenHome(project.path, home),
        project.branch ? `on ${project.branch}` : 'not a git repo',
        active ? 'this is the active project' : '⏎ to switch here',
        `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`,
        project.hasClaudeDir ? 'has a .claude directory' : '',
        project.exists ? '' : 'this path is missing on disk',
      ]}
      hint="⏎ switch   x clear   o browser"
      width={width}
    />
  )
}
