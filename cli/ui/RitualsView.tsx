import { Box, Text, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { compactAge, matchesFilter, pad, windowAround, type Tone } from '../format'
import type { RitualHistory, Schedule } from '../types'
import { untilLabel } from '~/utils/wall'
import {
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { ACCENT, isWide, listCapacity, listLayout } from './theme'

export function RitualsView({ isActive }: { isActive: boolean }) {
  const { api, mode, setMode, action, openBrowser } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const [filter, setFilter] = useState('')
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  const poll = usePoll(signal => Promise.all([
    api.schedules(signal),
    api.scheduleHistory(signal),
  ]).then(([schedules, histories]) => ({ schedules, histories })), 15_000)

  const schedules = poll.data?.schedules ?? []
  const histories = poll.data?.histories ?? {}
  const visible = useMemo(
    () => schedules.filter(s => matchesFilter(`${s.title} ${s.description} ${s.input}`, filter)),
    [schedules, filter],
  )
  const [index] = useSelection(visible.length, isActive && mode === 'nav' && !historyFor)
  const selected = visible[index]
  const chrome = wide ? 10 : 13
  const shown = windowAround(visible, index, listCapacity(rows, chrome, 2))
  const paused = schedules.filter(s => s.pausedReason).length
  const listWidth = wide ? Math.floor(columns * 0.52) : layout.inner
  const inspectorWidth = wide ? Math.max(24, columns - listWidth - 8) : layout.inner

  useInput((input, key) => {
    if (historyFor) {
      if (key.escape) setHistoryFor(null)
      return
    }
    if (input === '/') setMode('filter')
    if (key.return && selected) setHistoryFor(selected.id)
    if (input === 'e' && selected) void toggle(selected)
    if (input === 'r' && selected) void runNow(selected)
    if (input === 'o') openBrowser('/schedules')
  }, { isActive: isActive && (mode === 'nav' || Boolean(historyFor)) })

  async function toggle(schedule: Schedule) {
    await action.run(null, () => api.saveSchedule({
      ...schedule,
      title: schedule.title,
      input: schedule.input,
      enabled: !schedule.enabled,
    }))
    poll.refresh()
  }

  async function runNow(schedule: Schedule) {
    await action.run('Starting…', () => api.startRun({
      input: schedule.input,
      title: schedule.title,
      invocation: schedule.invocation,
      agentSlug: schedule.agentSlug,
      projectDir: schedule.projectDir,
      kind: 'command',
    }))
    poll.refresh()
  }

  if (historyFor) {
    const schedule = schedules.find(s => s.id === historyFor)
    const history = histories[historyFor]
    return (
      <History
        title={schedule?.title || historyFor}
        history={history}
      />
    )
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !poll.data ? (
        <EmptyState>{poll.error}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'No rituals. Press o to write one in the browser.'}</EmptyState>
      ) : (
        shown.map(schedule => (
          <RitualRow
            key={schedule.id}
            schedule={schedule}
            history={histories[schedule.id]}
            selected={schedule.id === selected?.id}
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
        list={list}
        inspector={
          selected ? (
            <DailyInspector
              schedule={selected}
              history={histories[selected.id]}
              width={inspectorWidth}
            />
          ) : (
            <Inspector
              title="Daily"
              lines={[
                `${schedules.length} ritual${schedules.length === 1 ? '' : 's'}`,
                paused ? `${paused} paused by the scheduler` : '',
              ]}
              hint="⏎ history   e enable/disable   r run now"
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

function ritualTone(schedule: Schedule, history?: RitualHistory): Tone {
  const streak = history?.failingStreak ?? 0
  if (schedule.pausedReason) return 'yellow'
  if (!schedule.enabled) return 'gray'
  if (streak >= 2) return 'yellow'
  return 'green'
}

function ritualStatus(schedule: Schedule, history?: RitualHistory): string {
  const streak = history?.failingStreak ?? 0
  if (schedule.pausedReason) return 'Paused'
  if (!schedule.enabled) return 'Disabled'
  if (streak >= 2) return `${streak} failed`
  return 'On'
}

function RitualRow({
  schedule,
  history,
  selected,
  width,
}: {
  schedule: Schedule
  history?: RitualHistory
  selected: boolean
  width: number
}) {
  const tone = ritualTone(schedule, history)
  const detail = [
    schedule.description,
    schedule.lastRunAt ? `ran ${compactAge(schedule.lastRunAt)}` : 'never ran',
  ].join(' · ')

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} />}
      status={ritualStatus(schedule, history)}
      statusTone={tone}
      title={schedule.title}
      trailing={schedule.nextRunAt ? untilLabel(schedule.nextRunAt, Date.now()) : ''}
      detail={detail}
      width={width}
    />
  )
}

function DailyInspector({
  schedule,
  history,
  width,
}: {
  schedule: Schedule
  history?: RitualHistory
  width: number
}) {
  const last = history?.runs[0]
  return (
    <Inspector
      title={schedule.title}
      lines={[
        schedule.description,
        schedule.pausedReason ? `paused: ${schedule.pausedReason}` : (schedule.enabled ? 'enabled' : 'disabled'),
        schedule.nextRunAt ? `next ${untilLabel(schedule.nextRunAt, Date.now())}` : 'not scheduled',
        last ? `last ${last.outcome}${last.costUsd != null ? ` · $${last.costUsd.toFixed(2)}` : ''}` : 'no runs yet',
        schedule.input,
      ]}
      hint="⏎ history   e enable/disable   r run now   o browser"
      width={width}
    />
  )
}

function History({ title, history }: { title: string; history?: RitualHistory }) {
  const runs = history?.runs ?? []
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text>
        <Text color="gray">← </Text>
        <Text color={ACCENT} bold>{title}</Text>
      </Text>
      <Box paddingTop={1} flexDirection="column">
        {runs.length === 0 ? (
          <EmptyState>No runs recorded yet.</EmptyState>
        ) : (
          runs.slice(0, 16).map(run => (
            <Text key={run.id} color="gray">
              {pad(run.outcome, 10)}
              {compactAge(run.at).padEnd(6)}
              {run.costUsd != null ? `  $${run.costUsd.toFixed(2)}` : ''}
              {run.error ? `  ${run.error}` : ''}
            </Text>
          ))
        )}
      </Box>
      <Box paddingTop={1}>
        <Text color="gray">esc back</Text>
      </Box>
    </Box>
  )
}
