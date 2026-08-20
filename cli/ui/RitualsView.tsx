import { Box, Text, useInput } from 'ink'
import { useMemo, useState } from 'react'
import { untilLabel } from '~/utils/wall'
import { hint } from '../keymap'
import { compactAge, matchesFilter, pad, windowAround, type Tone } from '../format'
import type { RitualHistory, Schedule } from '../types'
import {
  Confirm,
  EmptyState,
  FilterBar,
  Glyph,
  Inspector,
  Split,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize } from './hooks'
import { ACCENT, CHROME, isWide, listCapacity, listLayout, splitWidths } from './theme'

export function RitualsView({ isActive }: { isActive: boolean }) {
  const { api, mode, setMode, action, openBrowser, motions, nudge, rowHeight } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns)
  const [filter, setFilter] = useState('')
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Schedule | null>(null)

  const poll = usePoll(
    signal => Promise.all([
      api.schedules(signal),
      api.scheduleHistory(signal),
    ]).then(([schedules, histories]) => ({ schedules, histories })),
    { every: 30_000, deps: [nudge] },
  )

  const schedules = poll.data?.schedules ?? []
  const histories = poll.data?.histories ?? {}
  const visible = useMemo(
    () => schedules.filter(s => matchesFilter(`${s.title} ${s.description} ${s.input}`, filter)),
    [schedules, filter],
  )

  const capacity = listCapacity(rows, [wide ? 0 : CHROME.inspector], rowHeight)
  const [index] = useSelection(
    visible.length,
    motions,
    isActive && mode === 'nav' && !historyFor && !confirming,
    capacity,
  )
  const selected = visible[index]
  const shown = windowAround(visible, index, capacity)
  const paused = schedules.filter(s => s.pausedReason).length

  useInput((input, key) => {
    if (confirming) {
      if (input === 'y') {
        const schedule = confirming
        setConfirming(null)
        void runNow(schedule)
      }
      if (input === 'n' || key.escape) setConfirming(null)
      return
    }
    if (historyFor) {
      if (key.escape) setHistoryFor(null)
      return
    }
    if (input === '/') setMode('filter')
    if (key.return && selected) setHistoryFor(selected.id)
    if (input === 'e' && selected) void toggle(selected)
    /**
     * `r` refreshes, everywhere. It used to start an agent run on this one
     * screen, which the footer and the help page both described as "refresh" —
     * a mistyped key that costs money is not a key worth saving.
     */
    if (input === 'r') poll.refresh()
    if (input === 'R' && selected) setConfirming(selected)
    if (input === 'o') openBrowser('/schedules')
  }, { isActive: isActive && (mode === 'nav') })

  async function toggle(schedule: Schedule) {
    await action.run(`toggle:${schedule.id}`, null, () => api.saveSchedule({
      ...schedule,
      title: schedule.title,
      input: schedule.input,
      enabled: !schedule.enabled,
    }))
    poll.refresh()
  }

  async function runNow(schedule: Schedule) {
    await action.run(`run:${schedule.id}`, 'Starting it…', () => api.startRun({
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
    return (
      <History
        title={schedules.find(s => s.id === historyFor)?.title || historyFor}
        history={histories[historyFor]}
      />
    )
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      {poll.loading && !poll.data ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !poll.data ? (
        <EmptyState>{`${poll.error}  ·  r to try again`}</EmptyState>
      ) : visible.length === 0 ? (
        <EmptyState>{filter ? 'Nothing matches.' : 'No rituals. Press o to write one in the browser.'}</EmptyState>
      ) : (
        shown.map(schedule => (
          <RitualRow
            key={schedule.id}
            schedule={schedule}
            history={histories[schedule.id]}
            selected={schedule.id === selected?.id}
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
        list={list}
        inspector={
          selected ? (
            <DailyInspector
              schedule={selected}
              history={histories[selected.id]}
              width={wide ? widths.inspector : layout.inner}
              at={position(index, visible.length, shown.length)}
            />
          ) : (
            <Inspector
              title="Daily"
              lines={[
                `${schedules.length} ritual${schedules.length === 1 ? '' : 's'}`,
                paused ? `${paused} paused by the scheduler` : '',
              ]}
              hint={hint(['daily.history', 'daily.toggle', 'daily.run'])}
              width={wide ? widths.inspector : layout.inner}
            />
          )
        }
      />
      {confirming ? (
        <Confirm
          question={`Run "${confirming.title}" now?`}
          detail={[
            'It starts an agent, which costs money and may write to the repository.',
            confirming.projectDir ? `in ${confirming.projectDir}` : '',
          ]}
        />
      ) : null}
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
  spaced,
}: {
  schedule: Schedule
  history?: RitualHistory
  selected: boolean
  width: number
  spaced: boolean
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
      spaced={spaced}
    />
  )
}

function DailyInspector({
  schedule,
  history,
  width,
  at,
}: {
  schedule: Schedule
  history?: RitualHistory
  width: number
  at?: string
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
        at ?? '',
      ]}
      hint={hint(['daily.history', 'daily.toggle', 'daily.run', 'refresh'])}
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
            <Text key={run.id} color="gray" wrap="truncate">
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
