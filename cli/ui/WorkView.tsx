import { Box, Text, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { formatCost, formatDuration } from '~/utils/time'
import { buildWorkList, onTab, tabCounts, WORK_ORIGIN, type WorkItem, type WorkTab } from '~/utils/workList'
import { compactAge, matchesFilter, spinnerFrame, toneForWorkStatus, windowAround } from '../format'
import type { Session } from '../types'
import {
  Chips,
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TextField,
  TwoLineRow,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize, useTick } from './hooks'
import { isWide, listCapacity, listLayout } from './theme'

/**
 * Sessions and runs as one list, the way `/work` is in the browser.
 *
 * There is no Sessions view any more. A session is a row here — in flight
 * while it still wants something from you, in history once it is finished
 * with. `n` starts one. Enter opens it, or a run that no session owns.
 */
export function WorkView({
  onOpenSession,
  onOpenRun,
  isActive,
}: {
  onOpenSession: (id: string) => void
  onOpenRun: (id: string) => void
  isActive: boolean
}) {
  const { api, mode, setMode, action, projects, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState<WorkTab>('flight')
  const [draft, setDraft] = useState('')

  const poll = usePoll(signal => Promise.all([
    api.sessions(signal),
    api.runs(signal),
  ]).then(([sessions, runs]) => ({ sessions, runs })), 4000, [projects?.activePath])

  const sessions = poll.data?.sessions ?? []
  const runs = poll.data?.runs ?? []

  const items = useMemo(
    () => buildWorkList({ sessions: sessions as never, runs: runs as never }),
    [sessions, runs],
  )

  const counts = useMemo(() => tabCounts(items), [items])
  const onThisTab = useMemo(() => onTab(items, tab), [items, tab])
  const visible = useMemo(
    () => onThisTab.filter(item => matchesFilter(
      `${item.title} ${item.outcome} ${item.detail ?? ''} ${item.origin}`,
      filter,
    )),
    [onThisTab, filter],
  )

  const tick = useTick(visible.some(item => item.status === 'running'))
  const [index] = useSelection(visible.length, isActive && mode === 'nav')
  const selected = visible[index]
  const chrome = wide ? 11 : 14
  const shown = windowAround(visible, index, listCapacity(rows, chrome, 2))

  useInput((input, key) => {
    if (input === '/') {
      setMode('filter')
      return
    }
    if (input === 'n') {
      setTab('flight')
      setDraft('')
      setMode('compose')
      return
    }
    if (key.tab) {
      setTab(current => (current === 'flight' ? 'history' : 'flight'))
      return
    }
    if (key.return && selected) open(selected)
    if (input === 'r') poll.refresh()
    if (input === 'o') {
      if (selected) openBrowser(selected.to)
      else openBrowser('/work')
    }
  }, { isActive: isActive && mode === 'nav' })

  function open(item: WorkItem) {
    if (item.key.startsWith('session:')) onOpenSession(item.key.slice('session:'.length))
    else if (item.runId) onOpenRun(item.runId)
  }

  async function create() {
    const prompt = draft.trim()
    if (!prompt) return
    const repoDir = projects?.activePath
    if (!repoDir) {
      await action.run(null, async () => {
        throw new Error('Pick a project first — ] to switch, or 6 to pick one.')
      })
      return
    }
    const started = await action.run('Starting…', () => api.startSession({ prompt, repoDir }))
    if (started) {
      setDraft('')
      setMode('nav')
      poll.refresh()
    }
  }

  const selectedSession = selected?.key.startsWith('session:')
    ? sessions.find(session => session.id === selected.key.slice('session:'.length))
    : undefined

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <Chips
        active={tab}
        items={[
          { id: 'flight', label: 'In flight', count: counts.flight },
          { id: 'history', label: 'History', count: counts.history },
        ]}
      />
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !poll.data ? (
        <EmptyState>{poll.error}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>
          {filter
            ? 'Nothing matches.'
            : tab === 'flight'
              ? 'Nothing in flight. Press n to start a session.'
              : 'Nothing in history yet.'}
        </EmptyState>
      ) : (
        shown.map(item => (
          <WorkRow
            key={item.key}
            item={item}
            selected={item.key === selected?.key}
            width={wide ? Math.min(layout.inner, Math.floor(columns * 0.52)) : layout.inner}
            frame={spinnerFrame(tick)}
          />
        ))
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Split
        wide={wide}
        listWidth={Math.floor(columns * 0.52)}
        list={list}
        inspector={
          selected ? (
            <WorkInspector
              item={selected}
              session={selectedSession}
              width={wide ? Math.max(24, columns - Math.floor(columns * 0.52) - 8) : layout.inner}
            />
          ) : (
            <Inspector
              title={tab === 'flight' ? 'Nothing in flight' : 'History'}
              lines={[tab === 'flight'
                ? 'Sessions that still want something from you live here.'
                : 'Finished work, and runs that no session owns.']}
              hint="n new session   tab switch lists"
              width={layout.inner}
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
      {mode === 'compose' && isActive ? (
        <Box paddingTop={1} flexDirection="column">
          <TextField
            value={draft}
            onChange={setDraft}
            onSubmit={() => { void create() }}
            onCancel={() => {
              setDraft('')
              setMode('nav')
            }}
            isActive
            prefix="› "
            placeholder="what should this session work on?"
          />
        </Box>
      ) : null}
    </Box>
  )
}

function WorkRow({
  item,
  selected,
  width,
  frame,
}: {
  item: WorkItem
  selected: boolean
  width: number
  frame: string
}) {
  const tone = toneForWorkStatus(item.status)
  const origin = WORK_ORIGIN.find(entry => entry.value === item.origin)?.label ?? item.origin
  const bits = [
    item.outcome,
    item.detail,
    item.changedFiles ? `${item.changedFiles} file${item.changedFiles === 1 ? '' : 's'}` : null,
    item.turnCount ? `${item.turnCount} turn${item.turnCount === 1 ? '' : 's'}` : null,
    formatCost(item.costUsd),
    formatDuration(item.durationMs),
    origin !== 'yours' ? origin : null,
  ].filter(Boolean)

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} spinning={item.status === 'running'} frame={frame} />}
      title={item.title}
      trailing={compactAge(item.at)}
      detail={bits.join(' · ') || ' '}
      width={width}
    />
  )
}

function WorkInspector({
  item,
  session,
  width,
}: {
  item: WorkItem
  session?: Session
  width: number
}) {
  const origin = WORK_ORIGIN.find(entry => entry.value === item.origin)?.label ?? item.origin
  const lines: string[] = [item.outcome]

  if (session) {
    const wt = session.worktree
    const files = wt.changedFiles
      ? `${wt.changedFiles} file${wt.changedFiles === 1 ? '' : 's'}${wt.dirty ? ', uncommitted' : ''}`
      : 'no files changed'
    lines.push(`${session.branch} → ${session.baseBranch}`)
    if (wt.ahead || wt.behind) {
      lines.push([
        wt.ahead ? `${wt.ahead} ahead` : null,
        wt.behind ? `${wt.behind} behind` : null,
      ].filter(Boolean).join(' · '))
    }
    lines.push(files)
    if (session.check) lines.push(`checks ${session.check.status}`)
    if (session.pendingPermissions) lines.push(`${session.pendingPermissions} waiting on permission`)
    if (session.summary?.text) lines.push(session.summary.text)
  } else {
    if (item.detail) lines.push(item.detail)
    const extras = [
      origin,
      formatCost(item.costUsd),
      formatDuration(item.durationMs),
      compactAge(item.at),
    ].filter(Boolean)
    if (extras.length) lines.push(extras.join(' · '))
  }

  return (
    <Inspector
      title={item.title}
      lines={lines}
      hint="⏎ open   n new   tab history   o browser"
      width={width}
    />
  )
}

export function RunDetailView({
  id,
  onBack,
  isActive,
}: {
  id: string
  onBack: () => void
  isActive: boolean
}) {
  const { api, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const width = Math.max(20, columns - 4)
  const poll = usePoll(signal => api.run(id, signal), 4000, [id])
  const run = poll.data

  useInput((input, key) => {
    if (key.escape) onBack()
    if (input === 'o') openBrowser(`/runs/${id}`)
    if (input === 'r') poll.refresh()
  }, { isActive })

  if (poll.loading && !run) return <EmptyState>Loading…</EmptyState>
  if (!run) return <EmptyState>{poll.error || 'That run is gone.'}</EmptyState>

  const output = (run.output || run.error || '').trim() || 'No output.'
  const lines = output.split('\n').slice(0, Math.max(4, rows - 10))

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text>
        <Text color="gray">← </Text>
        <Text bold>{run.title}</Text>
        <Text color="gray">{`    ${run.status}`}</Text>
      </Text>
      <Box paddingTop={1} flexDirection="column">
        <Text color="gray">{run.input}</Text>
        <Box paddingTop={1} flexDirection="column">
          {lines.map((line, i) => (
            <Text key={i}>{line.slice(0, width) || ' '}</Text>
          ))}
        </Box>
      </Box>
      <Box paddingTop={1}>
        <Text color="gray">esc back   o browser</Text>
      </Box>
    </Box>
  )
}
