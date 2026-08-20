import { Box, Text, useInput } from 'ink'
import { useMemo, useRef } from 'react'
import { describeToolCall, presentVerb } from '~/utils/toolCalls'
import {
  URGENCY_LABELS,
  countUrgency,
  elapsedLabel,
  isCurrent,
  landedLabel,
  moneyLabel,
  moodOf,
  orderTiles,
  quotaMeter,
  spendMeter,
  untilLabel,
  urgencyOf,
  type WallSnapshot,
  type WallTile,
} from '~/utils/wall'
import type { Keymap } from '../keymap'
import { compactAge, spinnerFrame, toneForUrgency, truncate, windowAround, type Tone } from '../format'
import {
  EmptyState,
  Glyph,
  Inspector,
  MeterBar,
  Meters,
  PermissionFrame,
  Rule,
  Split,
  TwoLineRow,
  position,
} from './components'
import { useStudio } from './context'
import { usePoll, useSelection, useTerminalSize, useTick } from './hooks'
import { CHROME, contentHeight, isWide, listLayout, rowsIn, splitWidths } from './theme'

/**
 * The fleet, as a dashboard rather than another list.
 *
 * Meters first (is anything wrong, is anything happening, what did today
 * cost), then tiles grouped by whether the next move is yours, then a ticker
 * of what just happened. Permission prompts can be answered from the row
 * that says they are waiting — walking into the session to press the same
 * two buttons is the trip this screen exists to save.
 */
export function FleetView({
  onOpenSession,
  isActive,
}: {
  onOpenSession: (id: string) => void
  isActive: boolean
}) {
  const { api, keys, mode, jobs, openBrowser, motions, nudge, rowHeight } = useStudio()
  const { columns, rows } = useTerminalSize()
  const layout = listLayout(columns)
  const wide = isWide(columns)
  const widths = splitWidths(columns, 0.55)

  // Three seconds is right while agents are working and profligate when the
  // fleet is asleep, which is most of the day. The browser's own wall settles
  // at ten; this settles at fifteen and gets nudged awake by the notification
  // stream the moment anything happens.
  const moving = useRef(true)
  const poll = usePoll(signal => api.wall(signal), {
    every: 3_000,
    idle: 15_000,
    live: moving.current,
    deps: [nudge],
  })
  const snapshot = poll.data
  const tiles = useMemo(() => {
    if (!snapshot) return []
    return orderTiles(snapshot.tiles.filter(tile => isCurrent(tile, snapshot.at)))
  }, [snapshot])

  const working = tiles.some(tile => tile.activity === 'working')
  moving.current = working || tiles.some(tile => tile.prompts.length > 0)
  const tick = useTick(working, 1000)
  const clocks = Date.now()

  const meterRows = (snapshot?.spend.capUsd ? 1 : 0) + (snapshot?.quota ? 1 : 0)
  const capacity = rowsIn(
    contentHeight(rows) - CHROME.meters - meterRows - CHROME.rule - (wide ? 0 : 8),
    rowHeight,
  )
  const [index] = useSelection(tiles.length, motions, isActive && mode === 'nav', capacity)
  const selected = tiles[index]
  const shown = windowAround(tiles, index, capacity)
  const counts = countUrgency(tiles)
  const mood = moodOf(tiles)
  const spend = snapshot ? spendMeter(snapshot.spend.todayUsd, snapshot.spend.capUsd) : null
  const quota = snapshot ? quotaMeter(snapshot.quota) : null

  useInput((input, key) => {
    if (key.return && selected) onOpenSession(selected.sessionId)
    if (keys.matches('refresh', input, key)) poll.refresh()
    if (keys.matches('browser', input, key)) openBrowser(selected?.prUrl ? selected.prUrl : '/wall')
    if (keys.matches('fleet.stop', input, key) && selected?.runId) void stop(selected)
    if (input === 'y' && selected) void answer(selected, 'allow', 'once')
    if (input === 'a' && selected) void answer(selected, 'allow', 'session')
    if (input === 'n' && selected) void answer(selected, 'deny')
  }, { isActive: isActive && mode === 'nav' })

  async function stop(tile: WallTile) {
    if (!tile.runId) return
    await jobs.run(`stop:${tile.sessionId}`, 'Stopping the run', () => api.cancelRun(tile.runId!))
    poll.refresh()
  }

  async function answer(tile: WallTile, behavior: 'allow' | 'deny', scope?: 'once' | 'session') {
    const prompt = tile.prompts[0]
    if (!prompt) return
    await jobs.run(
      `permission:${prompt.id}`,
      null,
      () => api.answerPermission(prompt.id, behavior, { scope }),
    )
    poll.refresh()
  }

  const list = (
    <Box flexDirection="column" flexGrow={1}>
      <Meters items={[
        { value: String(counts['needs-you']), label: 'need you', tone: counts['needs-you'] ? 'yellow' : 'gray' },
        { value: String(counts.working), label: 'working', tone: counts.working ? 'cyan' : 'gray' },
        { value: String(counts.broken), label: 'broken', tone: counts.broken ? 'red' : 'gray' },
        { value: snapshot ? moneyLabel(snapshot.spend.todayUsd) : '—', label: 'today', tone: spendTone(spend?.tone) },
      ]}
      />
      {spend && snapshot?.spend.capUsd ? (
        <MeterBar
          fraction={spend.fraction}
          width={Math.min(18, Math.floor(widths.list / 6))}
          tone={spendTone(spend.tone)}
          label={spend.label}
        />
      ) : null}
      {quota ? (
        <MeterBar
          fraction={quota.fraction}
          width={Math.min(18, Math.floor(widths.list / 6))}
          tone={spendTone(quota.tone)}
          label={quota.label}
        />
      ) : null}
      {poll.loading && !snapshot ? (
        <EmptyState>Loading…</EmptyState>
      ) : poll.error && !snapshot ? (
        <EmptyState>{`${poll.error}  ·  r to try again`}</EmptyState>
      ) : tiles.length === 0 ? (
        <EmptyState>
          {mood === 'quiet'
            ? 'The fleet is quiet. Upcoming rituals still show in the inspector.'
            : 'Nothing live right now.'}
        </EmptyState>
      ) : (
        shown.map((tile, i) => {
          const prev = shown[i - 1]
          const group = urgencyOf(tile)
          const prevGroup = prev ? urgencyOf(prev) : null
          return (
            <Box key={tile.sessionId} flexDirection="column" flexShrink={0}>
              {group !== prevGroup ? (
                <Rule label={`${URGENCY_LABELS[group]}  ${counts[group]}`} width={widths.list} />
              ) : null}
              <FleetRow
                tile={tile}
                selected={tile.sessionId === selected?.sessionId}
                width={widths.list}
                frame={spinnerFrame(tick)}
                now={clocks}
                spaced={rowHeight === 3}
              />
            </Box>
          )
        })
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
            <FleetInspector
              tile={selected}
              snapshot={snapshot}
              width={wide ? widths.inspector : layout.inner}
              now={clocks}
              at={position(index, tiles.length, shown.length)}
              keys={keys}
            />
          ) : (
            <FleetEmptyInspector
              snapshot={snapshot}
              width={wide ? widths.inspector : layout.inner}
              now={clocks}
              keys={keys}
            />
          )
        }
      />
      <Ticker snapshot={snapshot} width={layout.inner} />
    </Box>
  )
}

function spendTone(tone: 'quiet' | 'accent' | 'warning' | 'error' | undefined): Tone {
  switch (tone) {
    case 'accent':
      return 'cyan'
    case 'warning':
      return 'yellow'
    case 'error':
      return 'red'
    default:
      return 'gray'
  }
}

function tileDoing(tile: WallTile): string {
  const prompt = tile.prompts[0]
  if (prompt) {
    const { target } = describeToolCall({ toolName: prompt.toolName, input: prompt.input })
    return `wants to ${presentVerb(prompt.toolName)}${target ? `  ${target}` : ''}`
  }
  if (tile.repairing) return 'fixing its own checks'
  if (tile.doing) {
    const { verb, target } = describeToolCall({
      toolName: tile.doing.toolName,
      input: tile.doing.input,
    })
    return [verb, target].filter(Boolean).join('  ')
  }
  if (tile.check?.status === 'failing') return 'checks fail'
  if (tile.landedAt) return landedLabel(tile.landedHow ?? 'merged')
  return tile.branch
}

function FleetRow({
  tile,
  selected,
  width,
  frame,
  now,
  spaced,
}: {
  tile: WallTile
  selected: boolean
  width: number
  frame: string
  now: number
  spaced: boolean
}) {
  const urgency = urgencyOf(tile)
  const tone = toneForUrgency(urgency)
  const spinning = tile.activity === 'working'
  const trailing = tile.activity === 'working' && tile.startedAt
    ? elapsedLabel(tile.startedAt, now)
    : compactAge(tile.updatedAt, now)

  return (
    <TwoLineRow
      selected={selected}
      glyph={<Glyph tone={tone} spinning={spinning} frame={frame} />}
      title={tile.title}
      trailing={`${tile.repo}  ${trailing}`}
      detail={tileDoing(tile)}
      width={width}
      spaced={spaced}
    />
  )
}

function FleetInspector({
  tile,
  snapshot,
  width,
  now,
  at,
  keys,
}: {
  tile: WallTile
  snapshot: WallSnapshot | null
  width: number
  now: number
  at?: string
  keys: Keymap
}) {
  const prompt = tile.prompts[0]
  const lines = [
    `${tile.repo} · ${tile.branch}`,
    tileDoing(tile),
    tile.pending ? `${tile.pending} waiting on permission` : '',
    tile.activity === 'working' && tile.startedAt
      ? `running ${elapsedLabel(tile.startedAt, now)}`
      : `updated ${compactAge(tile.updatedAt, now)}`,
    tile.check ? `checks ${tile.check.status}${tile.checkStale ? ' (stale)' : ''}` : '',
    `${tile.turns} turn${tile.turns === 1 ? '' : 's'}${at ? `   ${at}` : ''}`,
  ]

  return (
    <Box flexDirection="column">
      <Inspector
        title={tile.title}
        lines={lines}
        hint={prompt
          ? `${keys.hint(['session.allow', 'session.deny'])}   ⏎ open`
          : keys.hint(['rail.open', 'fleet.stop', 'browser'])}
        width={width}
      />
      {prompt ? (
        <PermissionFrame
          verb={presentVerb(prompt.toolName)}
          target={describeToolCall({ toolName: prompt.toolName, input: prompt.input }).target}
          reason={<Text color="gray">y once     a for this run     n deny     ⏎ open it to say why</Text>}
        />
      ) : null}
      {snapshot ? <Upcoming snapshot={snapshot} width={width} now={now} /> : null}
    </Box>
  )
}

function FleetEmptyInspector({
  snapshot,
  width,
  now,
  keys,
}: {
  snapshot: WallSnapshot | null
  width: number
  now: number
  keys: Keymap
}) {
  const live = snapshot?.liveSessions ?? 0
  const paused = snapshot?.pausedRituals ?? 0
  return (
    <Box flexDirection="column">
      <Inspector
        title={live ? `${live} live on this machine` : 'The fleet is quiet'}
        lines={[
          snapshot
            ? `${snapshot.day.runs} runs today · ${snapshot.day.failed} failed · ${snapshot.day.lastHour} in the last hour`
            : '',
          paused ? `${paused} ritual${paused === 1 ? '' : 's'} paused by the scheduler` : '',
        ]}
        hint={keys.hint(['rail.open', 'browser'])}
        width={width}
      />
      {snapshot ? <Upcoming snapshot={snapshot} width={width} now={now} /> : null}
    </Box>
  )
}

function Upcoming({ snapshot, width, now }: { snapshot: WallSnapshot; width: number; now: number }) {
  const upcoming = snapshot.upcoming.slice(0, 4)
  if (upcoming.length === 0 && snapshot.landedToday.length === 0) return null
  return (
    <Box flexDirection="column" paddingTop={1}>
      {upcoming.length > 0 ? (
        <>
          <Text color="gray">UPCOMING</Text>
          {upcoming.map(ritual => (
            <Text key={ritual.id} color="gray" wrap="truncate">
              {truncate(
                `${untilLabel(ritual.at, now).padEnd(7)}  ${ritual.title}${ritual.repo ? `  · ${ritual.repo}` : ''}`,
                width,
              )}
            </Text>
          ))}
        </>
      ) : null}
      {snapshot.landedToday.length > 0 ? (
        <Text color="gray" wrap="truncate">
          {truncate(
            `landed today  ${snapshot.landedToday.map(item => item.title).join(' · ')}`,
            width,
          )}
        </Text>
      ) : null}
    </Box>
  )
}

function Ticker({ snapshot, width }: { snapshot: WallSnapshot | null; width: number }) {
  const ticks = snapshot?.ticker.slice(0, 4) ?? []
  if (ticks.length === 0) return null
  const parts = ticks.map((tick) => {
    const { verb, target } = describeToolCall({ toolName: tick.toolName, input: tick.input })
    return `${tick.repo}  ${[verb, target].filter(Boolean).join(' ')}`
  })
  return (
    <Box paddingTop={1}>
      <Text color="gray" wrap="truncate">
        {truncate(parts.join('   ·   '), width)}
      </Text>
    </Box>
  )
}
