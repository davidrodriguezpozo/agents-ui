import { Box, useInput } from 'ink'
import { useState } from 'react'
import { hint } from '../keymap'
import { matchesFilter, shortenHome, windowAround, type Tone } from '../format'
import type { Project } from '../types'
import {
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { useSelection, useTerminalSize } from './hooks'
import { CHROME, isWide, listCapacity, listLayout, splitWidths } from './theme'

/**
 * Which project this window is looking at.
 *
 * Two answers, deliberately: `⏎` points this client somewhere, and `S` also
 * writes it as the app's default. Pressing `]` used to do the second thing,
 * so cycling projects here moved the browser's floor and whatever the service
 * does with an unscoped request — a surprising amount of blast radius for a
 * key you press while looking around.
 */
export function ProjectsView({ isActive }: { isActive: boolean }) {
  const {
    projects, scope, setScope, makeDefault, scopeIsLocal, mode, setMode, openBrowser, motions, rowHeight,
  } = useStudio()
  const { columns, rows: termRows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns)
  const [filter, setFilter] = useState('')
  const home = projects?.home ?? ''
  const list = (projects?.projects ?? []).filter(p => matchesFilter(`${p.name ?? ''} ${p.path}`, filter))

  const capacity = listCapacity(termRows, [wide ? 0 : CHROME.inspector], rowHeight)
  const [index] = useSelection(list.length, motions, isActive && mode === 'nav', capacity)
  const selected = list[index]
  const shown = windowAround(list, index, capacity)

  useInput((input, key) => {
    if (input === '/') setMode('filter')
    if (key.return && selected) setScope(selected.path)
    if (input === 'S' && selected) void makeDefault(selected.path)
    if (input === 'x') setScope(null)
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
            here={project.path === scope}
            isDefault={project.path === projects?.activePath}
            selected={project.path === selected?.path}
            width={widths.list}
            spaced={rowHeight === 3}
          />
        ))
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Split
        wide={wide}
        listWidth={widths.list}
        list={rows}
        inspector={
          selected ? (
            <ProjectInspector
              project={selected}
              home={home}
              here={selected.path === scope}
              isDefault={selected.path === projects?.activePath}
              width={wide ? widths.inspector : layout.inner}
              at={position(index, list.length, shown.length)}
            />
          ) : (
            <Inspector
              title="Projects"
              lines={[
                scope ? shortenHome(scope, home) : 'None selected — just ~/.claude.',
                scopeIsLocal ? 'this window only; S makes it the app default' : '',
              ]}
              hint={hint(['projects.focus', 'projects.default', 'projects.clear'])}
              width={wide ? widths.inspector : layout.inner}
            />
          )
        }
      />
      {mode === 'filter' && isActive ? (
        <FilterBar
          value={filter}
          onChange={setFilter}
          onClose={(clear) => {
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
  here,
  isDefault,
  selected,
  width,
  spaced,
}: {
  project: Project
  home: string
  here: boolean
  isDefault: boolean
  selected: boolean
  width: number
  spaced: boolean
}) {
  const tone: Tone = !project.exists ? 'red' : here ? 'cyan' : 'gray'
  const status = !project.exists
    ? 'Missing'
    : here && isDefault
      ? 'Here'
      : here
        ? 'Here only'
        : isDefault
          ? 'App default'
          : 'Saved'

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} />}
      status={status}
      statusTone={tone}
      title={project.name || shortenHome(project.path, home)}
      trailing={project.branch || '—'}
      detail={`${shortenHome(project.path, home)} · ${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`}
      width={width}
      spaced={spaced}
    />
  )
}

function ProjectInspector({
  project,
  home,
  here,
  isDefault,
  width,
  at,
}: {
  project: Project
  home: string
  here: boolean
  isDefault: boolean
  width: number
  at?: string
}) {
  return (
    <Inspector
      title={project.name || shortenHome(project.path, home)}
      lines={[
        shortenHome(project.path, home),
        project.branch ? `on ${project.branch}` : 'not a git repo',
        here ? 'this window is looking here' : '⏎ to look here',
        isDefault ? 'the app default' : 'S to make it the app default too',
        `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`,
        project.hasClaudeDir ? 'has a .claude directory' : '',
        project.exists ? (at ?? '') : 'this path is missing on disk',
      ]}
      hint={hint(['projects.focus', 'projects.default', 'projects.clear', 'browser'])}
      width={width}
    />
  )
}
